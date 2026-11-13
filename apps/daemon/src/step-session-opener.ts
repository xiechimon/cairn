import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  DeliveredImage,
  SessionOpts,
} from '@cairn/shared';
import { noVisionSignalOf, transcriptPromptRowId } from '@cairn/shared';
import { SessionNotResumableError } from './backend/errors.js';
import type { StepJournal, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';
import { resolveDeliveredPrompt, resolveStepImagesOrRaw } from './step-attachments.js';
import { freshSessionPrompt, resumeMissNote } from './step-prompt.js';

export interface StepSessionOpenerInput {
  backend: AgentBackend;
  sessionOpts: SessionOpts;
  claimed: ClaimedStep;
  stepId: string;
  isChief: boolean;
  resume: { sessionId: string | null; prompt: string | null } | undefined;
  prompt: string;
  promptImages: DeliveredImage[] | undefined;
  imageSupport: boolean | null;
  freshPromptPaths: Parameters<typeof freshSessionPrompt>[1];
  modelKey: string;
  client: MachineApi;
  journal: StepJournal;
  transcript: TranscriptBuffer;
  logger: DaemonLogger;
  stepAttachmentsDir: string;
  now: () => number;
  forgetHandle: () => void;
  rememberImageSupport: (support: boolean | null) => void;
}

export class StepSessionOpener {
  continueId: string | null;
  promptImages: DeliveredImage[] | undefined;
  imageSupport: boolean | null;
  private activePrompt: string;
  private noVisionDegraded = false;

  constructor(private readonly input: StepSessionOpenerInput) {
    const { claimed, resume } = input;
    this.continueId =
      claimed.session.action === 'continue'
        ? (resume?.sessionId ?? claimed.session.sessionId)
        : null;
    this.activePrompt = input.prompt;
    this.promptImages = input.promptImages;
    this.imageSupport = input.imageSupport;
  }

  setImageSupport(support: boolean | null): void {
    this.imageSupport = support;
    this.input.rememberImageSupport(support);
  }

  open(): Promise<AgentSessionHandle> {
    const { backend, sessionOpts } = this.input;
    if (this.continueId === null) return backend.createSession(sessionOpts);
    return backend.continueSession(this.continueId, sessionOpts).catch(async (err: unknown) => {
      if (!(err instanceof SessionNotResumableError)) throw err;
      await this.fallBackToNewSession();
      return backend.createSession(sessionOpts);
    });
  }

  async retryWithoutImages(failureText: string, blocked: boolean): Promise<boolean> {
    const { input } = this;
    if (
      blocked ||
      this.noVisionDegraded ||
      this.promptImages === undefined ||
      !noVisionSignalOf(failureText)
    ) {
      return false;
    }
    const { stepId, sessionOpts, modelKey, logger } = input;
    this.noVisionDegraded = true;
    this.imageSupport = false;
    input.backend.rememberNoVision?.(sessionOpts.provider, sessionOpts.modelId);
    input.rememberImageSupport(false);
    const retryPrompt =
      this.continueId === null
        ? this.activePrompt
        : freshSessionPrompt(input.claimed, input.freshPromptPaths);
    const degraded = await resolveStepImagesOrRaw({
      text: retryPrompt,
      stepId,
      client: input.client,
      materializeDir: input.stepAttachmentsDir,
      log: (line) => logger.step(line),
      imageSupport: false,
    });
    sessionOpts.prompt = degraded.text;
    this.continueId = null;
    input.journal.update(stepId, { prompt: retryPrompt, sessionAction: 'new', sessionId: null });
    delete sessionOpts.promptImages;
    this.promptImages = undefined;
    logger.step(`image degrade retry: ${modelKey} rejected image input — retrying without images`);
    input.transcript.upsert({
      id: `image-skip-${stepId}`,
      role: 'system',
      content: `图片未被模型读取：模型 ${modelKey} 拒绝了图片输入（${failureText.slice(0, 200)}），已去掉图片重试本步骤`,
      createdAt: input.now(),
    });
    input.forgetHandle();
    return true;
  }

  private async fallBackToNewSession(): Promise<void> {
    const { input } = this;
    const { stepId, claimed, resume, logger, transcript, sessionOpts, modelKey, now } = input;
    if (resume?.prompt === null) {
      throw new Error(
        `recover step ${stepId}: continue session ${this.continueId} unavailable and no journal prompt to resend`,
      );
    }
    const missed = this.continueId ?? '';
    const note = resumeMissNote(missed, claimed);
    logger.step(`continue session unavailable (${missed}) — falling back to new session — ${note}`);
    transcript.upsert({
      id: `resume-miss-${stepId}`,
      role: 'system',
      content: note,
      createdAt: now(),
    });
    if (!resume) {
      const fresh = freshSessionPrompt(claimed, input.freshPromptPaths);
      input.journal.update(stepId, { prompt: fresh, sessionAction: 'new', sessionId: null });
      this.activePrompt = fresh;
      let delivery = fresh;
      let images: DeliveredImage[] | undefined;
      if (!input.isChief) {
        const resolved = await resolveDeliveredPrompt({
          text: fresh,
          stepId,
          client: input.client,
          materializeDir: input.stepAttachmentsDir,
          log: (line) => logger.step(line),
          imageSupport: this.imageSupport,
        });
        delivery = resolved.text;
        images = resolved.images;
        if (resolved.skippedNoVision > 0) {
          transcript.upsert({
            id: `image-skip-${stepId}`,
            role: 'system',
            content: `图片未被模型读取：模型 ${modelKey} 不支持图片输入，${resolved.skippedNoVision} 张图片未下载（步骤继续执行，请以文字描述或改用支持图片的模型）`,
            createdAt: now(),
          });
        }
      }
      sessionOpts.prompt = delivery;
      this.promptImages = images;
      if (images !== undefined) sessionOpts.promptImages = images;
      else delete sessionOpts.promptImages;
      transcript.upsert({
        id: transcriptPromptRowId(stepId),
        role: 'user',
        content: fresh,
        createdAt: now(),
      });
    }
    this.continueId = null;
  }
}

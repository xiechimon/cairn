import { useSearchParams } from 'react-router';
import {
  useMachines,
  useMembers,
  useProjectFiles,
  useProjects,
  useSkills,
  useTodos,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { withoutDeleted } from '../fixtures/deletions.js';
import { resolveScenario } from '../fixtures/scenario.js';
import type { FileMentionEntry, MentionGroups } from '../overlay/mention-token.js';

export function useThreadMentions(projectId: string | undefined): {
  groups: MentionGroups;
  files: FileMentionEntry[] | undefined;
} {
  const { live, teamId } = useLiveData();
  const [searchParams] = useSearchParams();
  const todosQ = useTodos(teamId, live);
  const membersQ = useMembers(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const filesQ = useProjectFiles(projectId, live);
  if (live) {
    return {
      groups: {
        todo: (todosQ.data ?? []).map((t) => ({
          id: t.id,
          label: `#${t.seqNum} ${t.title}`,
          seq: t.seqNum,
          subtitle: t.phase,
        })),
        agent: (membersQ.data ?? [])
          .filter((m) => m.memberType === 'agent')
          .map((m) => ({
            id: m.actorId,
            label: (m.actor as { displayName?: string } | undefined)?.displayName ?? m.actorId,
            subtitle:
              (m.actor as { description?: string | null } | undefined)?.description ?? undefined,
          })),
        project: (projectsQ.data ?? []).map((p) => ({ id: p.id, label: p.name })),
        skill: (skillsQ.data ?? []).map((s) => ({
          id: s.id,
          label: s.name,
          subtitle: s.description ?? undefined,
        })),
        machine: (machinesQ.data ?? []).map((m) => ({ id: m.id, label: m.name })),
      },
      files: (filesQ.data?.files ?? []).map((f) => ({ path: f.path, type: f.type })),
    };
  }
  const fixture = resolveScenario(searchParams);
  return {
    groups: {
      todo: withoutDeleted(fixture.todos).map((t) => ({
        id: t.id,
        label: `#${t.seqNum} ${t.title}`,
        seq: t.seqNum,
        subtitle: t.phase,
      })),
      agent: (fixture.team?.agents ?? []).map((a) => ({
        id: a.id,
        label: a.displayName,
        subtitle: a.role ?? a.model,
      })),
      project: Object.entries(fixture.projectNames ?? {}).map(([id, name]) => ({
        id,
        label: name,
      })),
      skill: (fixture.resources?.skills ?? []).map((s) => ({
        id: s.name,
        label: s.name,
        subtitle: s.description,
      })),
      machine: (fixture.resources?.machines ?? []).map((m) => ({ id: m.name, label: m.name })),
    },
    files: undefined,
  };
}

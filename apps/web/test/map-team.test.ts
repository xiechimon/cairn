import type { TeamMember } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { mapTeam } from '../src/api/mappers.js';

const agent = (actor: Record<string, unknown>) =>
  ({ memberType: 'agent', actorId: 'a1', actor }) as unknown as TeamMember;

describe('mapTeam', () => {
  it('leaves the model empty when the agent has none, so the view can translate the label', () => {
    const [card] = mapTeam([agent({ displayName: 'Planner' })]).agents;
    expect(card?.model).toBe('');
    expect(card?.isDefault).toBe(false);
  });

  it('keeps the model id bare and marks the default through isDefault', () => {
    const [card] = mapTeam([agent({ displayName: 'Coder', modelId: 'claude-sonnet-5-5' })]).agents;
    expect(card?.model).toBe('claude-sonnet-5-5');
    expect(card?.isDefault).toBe(true);
  });
});

import { ProposalScheduleSection } from './proposals-schedule.js';
import { ProposalActivitySection, ProposalPaletteSection } from './proposals-search.js';
import { ProposalSettingsSection } from './proposals-settings.js';

export function ProposalPagesSections() {
  return (
    <>
      <ProposalScheduleSection />
      <ProposalPaletteSection />
      <ProposalActivitySection />
      <ProposalSettingsSection />
    </>
  );
}

import { Tabs, TabsIndicator, TabsList, TabsTrigger } from '@cairn/web';

export const SlidingPill = () => (
  <Tabs defaultValue="week">
    <TabsList style={{ position: 'relative' }}>
      <TabsIndicator
        style={{
          position: 'absolute',
          top: 'var(--active-tab-top)',
          left: 'var(--active-tab-left)',
          width: 'var(--active-tab-width)',
          height: 'var(--active-tab-height)',
          borderRadius: 6,
          background: 'var(--background)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
        }}
      />
      <TabsTrigger value="day" style={{ zIndex: 1, background: 'transparent' }}>Today</TabsTrigger>
      <TabsTrigger value="week" style={{ zIndex: 1, background: 'transparent' }}>This week</TabsTrigger>
      <TabsTrigger value="month" style={{ zIndex: 1, background: 'transparent' }}>This month</TabsTrigger>
    </TabsList>
  </Tabs>
);

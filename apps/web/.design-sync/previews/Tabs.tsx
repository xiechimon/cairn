import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cairn/web';

export const Default = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="activity" style={{ flexDirection: 'column' }}>
      <TabsList>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="builds">Builds</TabsTrigger>
        <TabsTrigger value="pr">Pull request</TabsTrigger>
      </TabsList>
      <TabsContent value="activity">Implementer opened PR #2156 for task #104.</TabsContent>
      <TabsContent value="builds">Build #318 passed in 4m 12s.</TabsContent>
      <TabsContent value="pr">PR #2156 is Merged.</TabsContent>
    </Tabs>
  </div>
);

export const Line = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="open" style={{ flexDirection: 'column' }}>
      <TabsList variant="line">
        <TabsTrigger value="open">Open</TabsTrigger>
        <TabsTrigger value="merged">Merged</TabsTrigger>
        <TabsTrigger value="closed">Closed</TabsTrigger>
      </TabsList>
      <TabsContent value="open">12 open tasks in cairn.</TabsContent>
      <TabsContent value="merged">48 merged this week.</TabsContent>
      <TabsContent value="closed">3 closed without merge.</TabsContent>
    </Tabs>
  </div>
);

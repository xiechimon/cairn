import { Tabs, TabsList, TabsTrigger } from '@cairn/web';

export const States = () => (
  <Tabs defaultValue="builds">
    <TabsList>
      <TabsTrigger value="activity">Activity</TabsTrigger>
      <TabsTrigger value="builds">Builds</TabsTrigger>
      <TabsTrigger value="logs" disabled>Logs</TabsTrigger>
    </TabsList>
  </Tabs>
);

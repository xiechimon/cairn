import { Tabs, TabsList, TabsTrigger } from '@cairn/web';

export const Default = () => (
  <Tabs defaultValue="tasks">
    <TabsList>
      <TabsTrigger value="tasks">Tasks</TabsTrigger>
      <TabsTrigger value="agents">Agents</TabsTrigger>
      <TabsTrigger value="machines">Machines</TabsTrigger>
    </TabsList>
  </Tabs>
);

export const Line = () => (
  <Tabs defaultValue="agents">
    <TabsList variant="line">
      <TabsTrigger value="tasks">Tasks</TabsTrigger>
      <TabsTrigger value="agents">Agents</TabsTrigger>
      <TabsTrigger value="machines">Machines</TabsTrigger>
    </TabsList>
  </Tabs>
);

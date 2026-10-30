import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cairn/web';

export const ActivePanel = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="builds" style={{ flexDirection: 'column' }}>
      <TabsList>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="builds">Builds</TabsTrigger>
      </TabsList>
      <TabsContent value="activity">Implementer picked up task #104.</TabsContent>
      <TabsContent value="builds">
        Build #318 on omarchy: lint, typecheck and e2e:affected passed in 4m 12s.
      </TabsContent>
    </Tabs>
  </div>
);

// REST 路由。任务相关的端点在这里注册。
import { deleteMany, listTasks } from './tasks.js';

export function registerRoutes(app: App) {
  app.get('/api/tasks', (c) => c.json(listTasks(c.req.query('teamId')!)));
  app.post('/api/tasks/delete', (c) => c.json(deleteMany(c.body.ids)));
}

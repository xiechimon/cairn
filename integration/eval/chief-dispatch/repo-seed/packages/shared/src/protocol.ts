// 任务相关协议的单一来源。
export interface DeleteTasksResponse {
  /** 0.5.0 起新增 skipped：请求里不存在、因而未删除的 id。 */
  deleted: string[];
  skipped: string[];
}

export interface TaskRecord {
  id: string;
  teamId: string;
  title: string;
}

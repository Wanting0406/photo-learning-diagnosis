import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  AdminMembersResult, AddAdminMembersRequest, RemoveAdminMembersRequest,
  SearchUsersRequest, SearchUsersResult, MutateOk,
} from '@shared/api.interface';

function responseError(status: number, data: unknown): Error {
  if (status === 401) return new Error('登录已过期，请重新登录');
  if (status === 403) return new Error('无操作权限，仅管理员可管理管理员成员');
  if (data && typeof data === 'object' && 'message' in data) {
    const message = data.message;
    if (typeof message === 'string' && message) return new Error(message);
  }
  return new Error('操作未完成，请稍后重试');
}

async function request<T>(method: 'GET' | 'POST', path: string, data?: unknown): Promise<T> {
  try {
    const response = await axiosForBackend.request<T>({ method, url: `/api/role-manager/${path}`, data, timeout: 30000 });
    if (response.status >= 400) throw responseError(response.status, response.data);
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = error.response as { status?: number; data?: unknown } | undefined;
      if (response?.status) throw responseError(response.status, response.data);
    }
    if (error instanceof Error && !('isAxiosError' in error)) throw error;
    throw new Error('连接中断或处理超时，请稍后重试');
  }
}

export const fetchAdminMembers = (): Promise<AdminMembersResult> => request('GET', 'admin/members');
export const addAdminMembers = (data: AddAdminMembersRequest): Promise<MutateOk> => request('POST', 'admin/members', data);
export const removeAdminMembers = (data: RemoveAdminMembersRequest): Promise<MutateOk> => request('POST', 'admin/members/remove', data);
export const searchUsers = (data: SearchUsersRequest): Promise<SearchUsersResult> => request('POST', 'search-users', data);

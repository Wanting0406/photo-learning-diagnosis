import { Body, Controller, Get, Post, Query, BadRequestException } from '@nestjs/common';
import { NeedLogin, CanRole, AuthorizationSDK, AuthNPaasService } from '@lark-apaas/fullstack-nestjs-core';
import type { MemberMutationData, UserSimpleDTO } from '@lark-apaas/fullstack-nestjs-core';
import type {
  AdminMemberUser, AdminMembersResult, AddAdminMembersRequest, RemoveAdminMembersRequest,
  SearchUsersRequest, SearchUsersResult, MutateOk,
} from '@shared/api.interface';

type MiaodaProfile = Awaited<ReturnType<AuthNPaasService['listUsersByIds']>>[number];

const ADMIN_ROLE_BIZ_ID = 'admin';
const MAX_USER_ID_LENGTH = 64;
const MAX_PROFILE_LOOKUP = 100;

class MutateAdminMembersDto implements AddAdminMembersRequest {
  userIDs: string[] = [];
}

class SearchUsersDto implements SearchUsersRequest {
  query = '';
}

@Controller('api/role-manager')
export class RoleManagerController {
  constructor(
    private readonly authzSDK: AuthorizationSDK,
    private readonly authn: AuthNPaasService,
  ) {}

  private assertUserIDs(userIDs: string[]): void {
    if (!Array.isArray(userIDs) || userIDs.length === 0) {
      throw new BadRequestException('请选择要操作的成员');
    }
    if (userIDs.some((id: string) => typeof id !== 'string' || id.length === 0 || id.length > MAX_USER_ID_LENGTH)) {
      throw new BadRequestException('成员 ID 无效');
    }
  }

  private toAdminMemberUser(user: UserSimpleDTO): AdminMemberUser {
    return { userID: user.userID ?? '', name: user.name?.zh_cn ?? '', avatar: user.avatar ?? '' };
  }

  @Get('admin/members')
  @NeedLogin()
  @CanRole(['admin'])
  async listAdminMembers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ): Promise<AdminMembersResult> {
    const result = await this.authzSDK.members.list(ADMIN_ROLE_BIZ_ID, {
      type: 'User',
      page: Number.parseInt(page, 10) || 1,
      pageSize: Number.parseInt(pageSize, 10) || 50,
    });
    const users: UserSimpleDTO[] = result.members.userList ?? [];
    const userIDs: string[] = users
      .map((user: UserSimpleDTO) => user.userID ?? '')
      .filter((id: string) => id.length > 0)
      .slice(0, MAX_PROFILE_LOOKUP);
    const profiles: MiaodaProfile[] = userIDs.length > 0
      ? await this.authn.listUsersByIds(userIDs)
      : [];
    const profileByID = new Map<string, MiaodaProfile | null>();
    userIDs.forEach((id: string, index: number) => {
      profileByID.set(id, profiles[index] ?? null);
    });
    const memberUsers: AdminMemberUser[] = users.map((user: UserSimpleDTO) => {
      const userID: string = user.userID ?? '';
      const profile: MiaodaProfile | null = profileByID.get(userID) ?? null;
      const name: string = user.name?.zh_cn || profile?.name?.zh_cn || profile?.name?.en_us || '';
      const avatar: string = user.avatar || profile?.avatar?.image?.large || '';
      return { userID, name, avatar };
    });
    return { users: memberUsers, total: result.total, hasMore: result.hasMore };
  }

  @Post('admin/members')
  @NeedLogin()
  @CanRole(['admin'])
  async addAdminMembers(@Body() dto: MutateAdminMembersDto): Promise<MutateOk> {
    this.assertUserIDs(dto.userIDs);
    const members: MemberMutationData = {
      userList: dto.userIDs.map((userID: string) => ({ userID })),
    };
    await this.authzSDK.members.add(ADMIN_ROLE_BIZ_ID, { members });
    return { ok: true };
  }

  @Post('admin/members/remove')
  @NeedLogin()
  @CanRole(['admin'])
  async removeAdminMembers(@Body() dto: MutateAdminMembersDto): Promise<MutateOk> {
    this.assertUserIDs(dto.userIDs);
    const members: MemberMutationData = {
      userList: dto.userIDs.map((userID: string) => ({ userID })),
    };
    await this.authzSDK.members.remove(ADMIN_ROLE_BIZ_ID, { members });
    return { ok: true };
  }

  @Post('search-users')
  @NeedLogin()
  @CanRole(['admin'])
  async searchUsers(@Body() dto: SearchUsersDto): Promise<SearchUsersResult> {
    const query = dto.query.trim();
    if (!query) throw new BadRequestException('请输入搜索关键词');
    if (query.length > 50) throw new BadRequestException('搜索关键词过长');
    const result = await this.authzSDK.search.search({ query, pageSize: 10, page: 1 });
    const items: UserSimpleDTO[] = result.result.userResult?.items ?? [];
    return { users: items.map((user: UserSimpleDTO) => this.toAdminMemberUser(user)) };
  }
}

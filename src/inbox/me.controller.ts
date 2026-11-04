import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Authenticated, Caller } from '@nick-lukashik/auth/nest'
import { z } from 'zod'
import { ApiErrors } from '../common/openapi/openapi.js'
import { NotificationsService } from './notifications.service.js'

const listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(200).optional(),
})
type ListQuery = z.infer<typeof listQuerySchema>

/** The caller's own inbox. */
@ApiTags('inbox')
@ApiBearerAuth()
@Controller('me/notifications')
@Authenticated()
export class MeNotificationsController {
    constructor(private readonly notifications: NotificationsService) {}

    @Get()
    @ApiOperation({
        summary: 'Newest first, cursor pagination, with the unread count',
    })
    @ApiErrors(400, 401)
    list(
        @Caller() caller: AccessClaims,
        @Query({
            schema: listQuerySchema,
        })
        query: ListQuery,
    ) {
        return this.notifications.list(caller.userId, query.limit, query.cursor)
    }

    @Post(':id/read')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiErrors(401, 404)
    async read(@Caller() caller: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string) {
        await this.notifications.markRead(caller.userId, id)
    }

    @Post('read-all')
    @HttpCode(HttpStatus.OK)
    @ApiErrors(401)
    async readAll(@Caller() caller: AccessClaims) {
        return {
            read: await this.notifications.markAllRead(caller.userId),
        }
    }
}

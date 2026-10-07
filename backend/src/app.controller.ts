import {
  Body,
  Controller,
  Get,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { resolve } from 'node:path';
import { AppService } from './app.service';
import { ApiError } from './api-error';

const actionBodySchema: import('@nestjs/swagger').SchemaObject = {
  oneOf: [
    {
      type: 'object',
      required: ['action', 'username', 'password', 'invite_code'],
      properties: {
        action: { type: 'string', enum: ['register'] },
        username: { type: 'string', minLength: 2, maxLength: 20 },
        password: { type: 'string', minLength: 6 },
        display_name: { type: 'string' },
        invite_code: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'username', 'password'],
      properties: {
        action: { type: 'string', enum: ['login'] },
        username: { type: 'string' },
        password: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'token'],
      properties: {
        action: { type: 'string', enum: ['logout'] },
        token: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'token'],
      properties: {
        action: { type: 'string', enum: ['me'] },
        token: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'token'],
      properties: {
        action: { type: 'string', enum: ['getBootstrap'] },
        token: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'token'],
      properties: {
        action: { type: 'string', enum: ['getLedger'] },
        token: { type: 'string' },
        from: { type: 'string', format: 'date' },
        to: { type: 'string', format: 'date' },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
    {
      type: 'object',
      required: ['action', 'token', 'category_id', 'amount'],
      properties: {
        action: { type: 'string', enum: ['addTransaction'] },
        token: { type: 'string' },
        category_id: { type: 'string' },
        item_name: { type: 'string', maxLength: 30 },
        amount: { type: 'number', minimum: 0, exclusiveMinimum: true },
        date: { type: 'string', format: 'date' },
        note: { type: 'string', maxLength: 100 },
      },
    },
  ],
  discriminator: { propertyName: 'action' },
};

@ApiTags('家庭記帳 API')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  home(@Res() response: Response): void {
    response.sendFile(resolve(process.cwd(), '..', 'index.html'));
  }

  @Get('health')
  @ApiOperation({ summary: '檢查本機伺服器狀態' })
  @ApiOkResponse({ schema: { example: { ok: true, data: 'family ledger api is running' } } })
  health() {
    return { ok: true, data: 'family ledger api is running' };
  }

  @Post()
  @ApiOperation({
    summary: '家庭記帳 action API',
    description:
      '使用 POST JSON 呼叫 register、login、logout、me、getBootstrap、getLedger 或 addTransaction。',
  })
  @ApiBody({ schema: actionBodySchema })
  @ApiOkResponse({
    description: '成功回應；data 依 action 傳回對應內容。',
    schema: { example: { ok: true, data: {} } },
  })
  async action(
    @Body() body: unknown,
  ): Promise<{ ok: true; data: unknown }> {
    let parsed = body;
    if (typeof body === 'string') {
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        throw new ApiError('invalid_request', 400);
      }
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new ApiError('invalid_request', 400);
    }
    const data = await this.appService.dispatch(parsed as Record<string, unknown>);
    return { ok: true, data };
  }
}

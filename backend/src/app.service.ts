import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, Transaction } from '@prisma/client';
import { ApiError } from './api-error';
import { PrismaService } from './prisma.service';

const SESSION_DAYS = 30;
const PAGE_SIZE_DEFAULT = 10;
const PAGE_SIZE_MAX = 50;
const AMOUNT_CENTS_MAX = 2_147_483_647n;

type RequestBody = Record<string, unknown>;

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async dispatch(body: RequestBody): Promise<unknown> {
    switch (body.action) {
      case 'register':
        return this.register(body);
      case 'login':
        return this.login(body);
      case 'logout':
        return this.logout(body);
      case 'me':
        return this.me(body);
      case 'getBootstrap':
        return this.getBootstrap(body);
      case 'getLedger':
        return this.getLedger(body);
      case 'addTransaction':
        return this.addTransaction(body);
      default:
        throw new ApiError('unknown_action', 400);
    }
  }

  private async register(body: RequestBody) {
    const username = this.stringValue(body.username).trim();
    const password = this.stringValue(body.password);
    const displayName = this.stringValue(body.display_name).trim() || username;
    const inviteCode = this.stringValue(body.invite_code);

    if (username.length < 2 || username.length > 20) {
      throw new ApiError('username_length', 400);
    }
    if (password.length < 6) {
      throw new ApiError('password_too_short', 400);
    }
    if (inviteCode !== (process.env.INVITE_CODE ?? 'family-ledger-local')) {
      throw new ApiError('bad_invite_code', 403);
    }

    const salt = randomUUID();
    const userId = `u${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const token = randomBytes(32).toString('hex');
    const expiresAt = BigInt(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    const normalizedUsername = username.toLocaleLowerCase('en-US');

    try {
      await this.prisma.$transaction(async (database) => {
        await database.user.create({
          data: {
            userId,
            username: normalizedUsername,
            passwordHash: this.passwordHash(salt, password),
            salt,
            displayName,
          },
        });
        await database.session.create({
          data: { token, userId, expiresAt },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiError('username_taken', 409);
      }
      throw error;
    }

    return this.loginResponse(token, expiresAt, { userId, displayName });
  }

  private async login(body: RequestBody) {
    const username = this.stringValue(body.username).trim().toLocaleLowerCase('en-US');
    const password = this.stringValue(body.password);
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (
      !user ||
      !this.passwordMatches(user.salt, password, user.passwordHash)
    ) {
      throw new ApiError('invalid_credentials', 401);
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = BigInt(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({
      data: { token, userId: user.userId, expiresAt },
    });
    return this.loginResponse(token, expiresAt, {
      userId: user.userId,
      displayName: user.displayName,
    });
  }

  private async logout(body: RequestBody): Promise<boolean> {
    const session = await this.authenticate(body.token);
    await this.prisma.session.delete({ where: { token: session.token } });
    return true;
  }

  private async me(body: RequestBody) {
    const session = await this.authenticate(body.token);
    return { user_id: session.user.userId, display_name: session.user.displayName };
  }

  private async getBootstrap(body: RequestBody) {
    const session = await this.authenticate(body.token);
    const [categories, items, users] = await Promise.all([
      this.prisma.category.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.item.findMany({
        orderBy: [{ useCount: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.user.findMany({
        select: { userId: true, displayName: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      user: {
        user_id: session.user.userId,
        display_name: session.user.displayName,
      },
      categories: categories.map((category) => ({
        category_id: category.categoryId,
        name: category.name,
        type: category.type,
        icon: category.icon,
      })),
      items: items.map((item) => ({
        item_id: item.itemId,
        category_id: item.categoryId,
        name: item.name,
        use_count: item.useCount,
      })),
      users: users.map((user) => ({
        user_id: user.userId,
        display_name: user.displayName,
      })),
    };
  }

  private async getLedger(body: RequestBody) {
    await this.authenticate(body.token);
    const from = body.from === undefined ? '0000-00-00' : this.stringValue(body.from);
    const to = body.to === undefined ? '9999-99-99' : this.stringValue(body.to);
    if (
      (body.from !== undefined && !this.isDate(from)) ||
      (body.to !== undefined && !this.isDate(to)) ||
      from > to
    ) {
      throw new ApiError('bad_date', 400);
    }

    const offset = this.nonNegativeInteger(body.offset, 0);
    const limit = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, this.nonNegativeInteger(body.limit, PAGE_SIZE_DEFAULT)),
    );
    const dateFilter = { date: { gte: from, lte: to } };
    const [page, periodTotals, totalByType] = await Promise.all([
      this.prisma.transaction.findMany({
        where: dateFilter,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { txId: 'desc' }],
        skip: offset,
        take: limit + 1,
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: dateFilter,
        _sum: { amountCents: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        _sum: { amountCents: true },
      }),
    ]);

    const periodIncome = this.totalForType(periodTotals, 'income');
    const periodExpense = this.totalForType(periodTotals, 'expense');
    const overallIncome = this.totalForType(totalByType, 'income');
    const overallExpense = this.totalForType(totalByType, 'expense');
    const rows = page.slice(0, limit);

    return {
      rows: rows.map((transaction) => this.transactionResponse(transaction)),
      has_more: page.length > limit,
      summary: {
        income: this.amount(periodIncome),
        expense: this.amount(periodExpense),
        balance: this.amount(periodIncome - periodExpense),
      },
      total_balance: this.amount(overallIncome - overallExpense),
    };
  }

  private async addTransaction(body: RequestBody) {
    const session = await this.authenticate(body.token);
    const date =
      body.date === undefined || body.date === ''
        ? this.taipeiDate(new Date())
        : this.stringValue(body.date);
    if (!this.isDate(date)) {
      throw new ApiError('bad_date', 400);
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError('bad_amount', 400);
    }
    const amountCentsNumber = Math.round(amount * 100);
    if (
      !Number.isSafeInteger(amountCentsNumber) ||
      amountCentsNumber <= 0 ||
      BigInt(amountCentsNumber) > AMOUNT_CENTS_MAX
    ) {
      throw new ApiError('bad_amount', 400);
    }

    const categoryId = this.stringValue(body.category_id);
    if (!categoryId) {
      throw new ApiError('bad_category', 400);
    }
    const itemName = this.stringValue(body.item_name).trim().slice(0, 30);
    const note = this.stringValue(body.note).trim().slice(0, 100);
    const normalizedName = this.itemKey(itemName);

    const result = await this.prisma.$transaction(async (database) => {
      const category = await database.category.findUnique({
        where: { categoryId },
      });
      if (!category) {
        throw new ApiError('bad_category', 400);
      }

      let item:
        | {
            itemId: string;
            categoryId: string;
            name: string;
            useCount: number;
            isNew: boolean;
          }
        | null = null;
      if (itemName) {
        const existing = await database.item.findUnique({
          where: {
            categoryId_normalizedName: { categoryId, normalizedName },
          },
        });
        const now = BigInt(Date.now());
        if (existing) {
          const updated = await database.item.update({
            where: { itemId: existing.itemId },
            data: { useCount: { increment: 1 }, lastUsed: now },
          });
          item = { ...updated, isNew: false };
        } else {
          const created = await database.item.create({
            data: {
              itemId: `i${randomUUID().replace(/-/g, '').slice(0, 8)}`,
              categoryId,
              name: itemName,
              normalizedName,
              createdBy: session.user.userId,
              useCount: 1,
              lastUsed: now,
            },
          });
          item = { ...created, isNew: true };
        }
      }

      const transaction = await database.transaction.create({
        data: {
          txId: `t${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          date,
          userId: session.user.userId,
          type: category.type,
          categoryId,
          itemName: item?.name ?? '',
          amountCents: BigInt(amountCentsNumber),
          note,
        },
      });
      return { transaction, item };
    });

    return {
      transaction: this.transactionResponse(result.transaction),
      item: result.item
        ? {
            item_id: result.item.itemId,
            category_id: result.item.categoryId,
            name: result.item.name,
            use_count: result.item.useCount,
            is_new: result.item.isNew,
          }
        : null,
    };
  }

  private async loginResponse(
    token: string,
    expiresAt: bigint,
    user: { userId: string; displayName: string },
  ) {
    const [bootstrap, ledger] = await Promise.all([
      this.getBootstrap({ token }),
      this.getLedger({ token, limit: PAGE_SIZE_DEFAULT }),
    ]);
    return {
      token,
      expires_at: Number(expiresAt),
      user: { user_id: user.userId, display_name: user.displayName },
      bootstrap,
      ledger,
    };
  }

  private async authenticate(tokenValue: unknown) {
    const token = this.stringValue(tokenValue);
    if (!token) {
      throw new ApiError('unauthorized', 401);
    }
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!session || session.expiresAt <= BigInt(Date.now())) {
      throw new ApiError('unauthorized', 401);
    }
    return session;
  }

  private passwordHash(salt: string, password: string): string {
    return createHash('sha256').update(salt + password, 'utf8').digest('hex');
  }

  private passwordMatches(
    salt: string,
    password: string,
    expectedHash: string,
  ): boolean {
    const actual = Buffer.from(this.passwordHash(salt, password), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private itemKey(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
  }

  private isDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  private taipeiDate(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  private taipeiTimestamp(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  private transactionResponse(transaction: Transaction) {
    return {
      tx_id: transaction.txId,
      date: transaction.date,
      user_id: transaction.userId,
      type: transaction.type,
      category_id: transaction.categoryId,
      item_name: transaction.itemName,
      amount: this.amount(transaction.amountCents),
      note: transaction.note,
      created_at: this.taipeiTimestamp(transaction.createdAt),
    };
  }

  private totalForType(
    groups: Array<{ type: string; _sum: { amountCents: bigint | null } }>,
    type: string,
  ): bigint {
    return groups.find((group) => group.type === type)?._sum.amountCents ?? 0n;
  }

  private amount(cents: bigint): number {
    return Number(cents) / 100;
  }

  private nonNegativeInteger(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }
}

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  { categoryId: 'c01', name: '飲食', type: 'expense', icon: '🍜', sort: 1 },
  { categoryId: 'c02', name: '交通', type: 'expense', icon: '🚌', sort: 2 },
  { categoryId: 'c03', name: '居家', type: 'expense', icon: '🏠', sort: 3 },
  { categoryId: 'c04', name: '日用品', type: 'expense', icon: '🧴', sort: 4 },
  { categoryId: 'c05', name: '水電瓦斯', type: 'expense', icon: '💡', sort: 5 },
  { categoryId: 'c06', name: '醫療', type: 'expense', icon: '💊', sort: 6 },
  { categoryId: 'c07', name: '教育', type: 'expense', icon: '📚', sort: 7 },
  { categoryId: 'c08', name: '娛樂', type: 'expense', icon: '🎮', sort: 8 },
  { categoryId: 'c09', name: '服飾', type: 'expense', icon: '👕', sort: 9 },
  { categoryId: 'c10', name: '其他', type: 'expense', icon: '📦', sort: 10 },
  { categoryId: 'c11', name: '繳入公戶', type: 'income', icon: '💰', sort: 11 },
  { categoryId: 'c12', name: '其他收入', type: 'income', icon: '➕', sort: 13 },
];

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({
      where: { categoryId: category.categoryId },
      update: category,
      create: category,
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

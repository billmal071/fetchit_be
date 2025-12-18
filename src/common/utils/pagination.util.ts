import { IMeta, IPaginatedResult } from '../interfaces';

export function createPaginationMeta(page: number, limit: number, total: number): IMeta {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

export function paginateArray<T>(items: T[], page: number, limit: number): IPaginatedResult<T> {
  const total = items.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    data: paginatedItems,
    meta: createPaginationMeta(page, limit, total),
  };
}

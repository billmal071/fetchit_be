/**
 * Base Repository Interface
 *
 * Defines common CRUD operations for all repositories.
 * Entity-specific repositories should extend this interface
 * with additional methods as needed.
 */
export interface IBaseRepository<T, CreateDto, UpdateDto> {
  /**
   * Create a new entity
   */
  create(data: CreateDto): Promise<T>;

  /**
   * Find entity by ID
   */
  findById(id: string): Promise<T | null>;

  /**
   * Find all entities with optional pagination
   */
  findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<T[]>;

  /**
   * Count total entities
   */
  count(where?: Partial<T>): Promise<number>;

  /**
   * Update entity by ID
   */
  update(id: string, data: UpdateDto): Promise<T>;

  /**
   * Delete entity by ID (hard delete)
   */
  delete(id: string): Promise<void>;
}

/**
 * Soft Delete Repository Interface
 *
 * Extends base repository with soft delete capabilities.
 * Use this for entities that have a deletedAt field.
 */
export interface ISoftDeleteRepository<T, CreateDto, UpdateDto> extends IBaseRepository<
  T,
  CreateDto,
  UpdateDto
> {
  /**
   * Soft delete entity by ID
   */
  softDelete(id: string): Promise<void>;

  /**
   * Restore soft-deleted entity
   */
  restore(id: string): Promise<T>;

  /**
   * Find all including soft-deleted entities
   */
  findAllWithDeleted(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<T[]>;
}

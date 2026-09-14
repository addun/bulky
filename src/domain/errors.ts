export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super('not found');
  }
}

export class DuplicateError extends AppError {
  constructor() {
    super('already exists');
  }
}

export class UnitInUseError extends AppError {
  constructor() {
    super('unit is in use');
  }
}

export class StoryInUseError extends AppError {
  constructor() {
    super('story is in use');
  }
}

export class InvalidUnitError extends AppError {
  constructor() {
    super('invalid unit');
  }
}

export class InvalidStoryError extends AppError {
  constructor() {
    super('invalid story');
  }
}

export class InvalidKindError extends AppError {
  constructor() {
    super('invalid purchase kind');
  }
}

export class InvalidQuantityError extends AppError {
  constructor() {
    super('quantity must be greater than zero');
  }
}

export class AliasScopeError extends AppError {
  constructor() {
    super('alias cannot be both story and chain');
  }
}

export class SameProductError extends AppError {
  constructor() {
    super('cannot merge a product into itself');
  }
}

export class UnitMismatchError extends AppError {
  constructor() {
    super('products use different units');
  }
}

export class InvalidConversionError extends AppError {
  constructor() {
    super('invalid unit conversion');
  }
}

export class ConversionMismatchError extends AppError {
  constructor() {
    super('products convert to a unit differently');
  }
}

export class ConversionConflictError extends ConversionMismatchError {
  constructor(public readonly unitName: string) {
    super();
    this.message =
      unitName === ''
        ? 'products convert to a unit differently'
        : `products convert to ${unitName} differently`;
  }
}

export class InvalidComparisonGroupError extends AppError {
  constructor() {
    super('invalid comparison group');
  }
}

export class RetailChainInUseError extends AppError {
  constructor() {
    super('retail chain is in use');
  }
}

export class InvalidRetailChainError extends AppError {
  constructor() {
    super('invalid retail chain');
  }
}

export class ReceiptMigratedError extends AppError {
  constructor() {
    super('receipt already migrated');
  }
}

export class ReceiptNotReadyError extends AppError {
  constructor() {
    super('receipt is not ready to migrate');
  }
}

export function isUniqueErr(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes('unique');
}

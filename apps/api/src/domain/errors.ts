export abstract class AppError extends Error {
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
  constructor(message = 'That value already exists.') {
    super(message);
  }
}

export class UnitInUseError extends AppError {
  constructor() {
    super('unit is in use');
  }
}

export class StoreInUseError extends AppError {
  constructor() {
    super('store is in use');
  }
}

export class InvalidUnitError extends AppError {
  constructor(message = 'Choose a unit from the list.') {
    super(message);
  }
}

export class InvalidStoreError extends AppError {
  constructor(message = 'Choose a store.') {
    super(message);
  }
}

export class InvalidKindError extends AppError {
  constructor(message = 'Choose purchase or price.') {
    super(message);
  }
}

export class InvalidQuantityError extends AppError {
  constructor(message = 'Quantity must be greater than zero.') {
    super(message);
  }
}

export class AliasScopeError extends AppError {
  constructor(message = 'Choose either a chain or a store, not both.') {
    super(message);
  }
}

export class SameProductError extends AppError {
  constructor(message = 'Choose a different product.') {
    super(message);
  }
}

export class SameStoreError extends AppError {
  constructor(message = 'Choose a different store.') {
    super(message);
  }
}

export class UnitMismatchError extends AppError {
  constructor(message = 'Those products use different units.') {
    super(message);
  }
}

export class InvalidConversionError extends AppError {
  constructor(message = 'Choose one of the extra units on this product.') {
    super(message);
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
        ? 'Those products convert to a unit differently.'
        : `Those products convert to ${unitName} differently.`;
  }
}

export class InvalidComparisonGroupError extends AppError {
  constructor(message = 'Choose a comparison group.') {
    super(message);
  }
}

export class RetailChainInUseError extends AppError {
  constructor() {
    super('retail chain is in use');
  }
}

export class InvalidRetailChainError extends AppError {
  constructor(message = 'Choose a retail chain.') {
    super(message);
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

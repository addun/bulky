export const SETTING_OCR_MODEL = 'ocr_model';
export const SETTING_PIECE_UNIT_ID = 'piece_unit_id';
export const SETTING_WEIGHT_UNIT_ID = 'weight_unit_id';

export type Unit = {
  id: number;
  name: string;
  productCount: number;
};

export type UnitDefaults = {
  pieceId: number | null;
  weightId: number | null;
};

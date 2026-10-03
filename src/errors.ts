export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number = 409
  ) {
    super(code);
  }
}
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const missing = () => new ApiError(404, 'not-found', 'This classroom or resource is not available to you.');

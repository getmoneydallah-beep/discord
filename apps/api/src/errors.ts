export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = "not_found") => new HttpError(404, what);
export const forbidden = () => new HttpError(403, "forbidden");
export const badRequest = (code: string) => new HttpError(400, code);

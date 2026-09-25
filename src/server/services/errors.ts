export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "erro",
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = "requisicao_invalida") => new AppError(400, msg, code);
export const unauthorized = (msg = "Faça login para continuar.") => new AppError(401, msg, "nao_autenticado");
export const forbidden = (msg = "Você não tem permissão para isso.") => new AppError(403, msg, "proibido");
export const notFound = (msg = "Não encontrado.") => new AppError(404, msg, "nao_encontrado");
export const conflict = (msg: string, code = "conflito") => new AppError(409, msg, code);
export const tooMany = (msg = "Muitas tentativas. Aguarde alguns minutos.") => new AppError(429, msg, "limite");

/**
 * Envio de e-mail. Em desenvolvimento, os e-mails vão para a tabela mail_outbox
 * (visível no painel admin) e para o console. Para produção, implemente
 * `Mailer` com um provedor SMTP/API e registre em setMailer().
 */
import { getDb, nowIso } from "../db/database";
import { newId } from "./ids";

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

class OutboxMailer implements Mailer {
  async send(to: string, subject: string, body: string): Promise<void> {
    await getDb().run("INSERT INTO mail_outbox(id,to_email,subject,body,created_at) VALUES(?,?,?,?,?)", newId(), to, subject, body, nowIso());
    if (process.env.NODE_ENV !== "test") console.info(`[mail] para=${to} assunto="${subject}"\n${body}`);
  }
}

let mailer: Mailer = new OutboxMailer();
export const getMailer = (): Mailer => mailer;
export const setMailer = (m: Mailer): void => {
  mailer = m;
};

/* مخزن تنظیمات تشخیص پیامک — اندپوینت‌های REST بک‌اند (/sms/...).

   نام‌گذاری بدون پیشوند «Supabase» است چون این مخزن از ابتدا REST-محور
   ساخته شده و هرگز روی سوپابیس نبوده. */

import type { Account } from "@/domain/account/account.types";
import type { SmsSettingsRepository } from "@/domain/sms/sms-settings.repository";
import type {
  SmsNumber,
  SmsNumberInput,
  SmsSender,
} from "@/domain/sms/sms-settings.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import { mapAccount, type AccountRow } from "./mappers";

type SenderRow = {
  id: string;
  account_id: string;
  sender: string;
};

type NumberRow = {
  id: string;
  member_id: string;
  phone: string;
  label: string;
  verified: boolean;
  active: boolean;
};

function mapSender(r: SenderRow): SmsSender {
  return { id: r.id, accountId: r.account_id, sender: r.sender };
}

function mapNumber(r: NumberRow): SmsNumber {
  return {
    id: r.id,
    memberId: r.member_id,
    phone: r.phone,
    label: r.label ?? "",
    /* هر دو با === true خوانده می‌شوند تا اگر سرور قدیمی فیلد را نفرستد،
       undefined به‌جای «تأییدشده» یا «فعال» تعبیر نشود. */
    verified: r.verified === true,
    active: r.active === true,
  };
}

export class RestSmsSettingsRepository implements SmsSettingsRepository {
  constructor(private readonly client: RestClient) {}

  async setEnabled(accountId: string, enabled: boolean): Promise<Account> {
    /* پاسخ، خودِ حسابِ به‌روزشده است تا کلاینت مجبور نباشد وضعیت را حدس بزند
       یا فهرست را دوباره بگیرد؛ هر چه سرور گفت همان نمایش داده می‌شود. */
    const row = await this.client.patch<AccountRow>(
      `/sms/accounts/${encodeURIComponent(accountId)}/enabled`,
      { enabled },
    );
    return mapAccount(row);
  }

  async resetAccount(accountId: string): Promise<void> {
    await this.client.del<void>(
      `/sms/accounts/${encodeURIComponent(accountId)}`,
    );
  }

  async listSenders(): Promise<SmsSender[]> {
    const rows = await this.client.get<SenderRow[]>("/sms/senders");
    return (rows ?? []).map(mapSender);
  }

  async addSender(accountId: string, sender: string): Promise<SmsSender> {
    const row = await this.client.post<SenderRow>(
      `/sms/accounts/${encodeURIComponent(accountId)}/senders`,
      { sender },
    );
    return mapSender(row);
  }

  async removeSender(senderId: string): Promise<void> {
    await this.client.del<void>(`/sms/senders/${encodeURIComponent(senderId)}`);
  }

  async listNumbers(): Promise<SmsNumber[]> {
    const rows = await this.client.get<NumberRow[]>("/sms/numbers");
    return (rows ?? []).map(mapNumber);
  }

  async addNumber(input: SmsNumberInput): Promise<SmsNumber> {
    const row = await this.client.post<NumberRow>("/sms/numbers", {
      phone: input.phone,
      label: input.label ?? null,
    });
    return mapNumber(row);
  }

  async setNumberActive(numberId: string, active: boolean): Promise<SmsNumber> {
    const row = await this.client.patch<NumberRow>(
      `/sms/numbers/${encodeURIComponent(numberId)}`,
      { active },
    );
    return mapNumber(row);
  }

  async removeNumber(numberId: string): Promise<void> {
    await this.client.del<void>(`/sms/numbers/${encodeURIComponent(numberId)}`);
  }
}

import { useEffect, useState } from "react";
import { formatCardFa, maskCardNumber } from "@/domain/account/account.rules";
import { Icon } from "@/shared/ui";
import { usePageActivity } from "@/shared/lib/pageActivity";

/** شمارهٔ کارت چهار گروه دارد و فقط با انتخاب کاربر کامل نمایش داده می‌شود. */
export function BankCardNumber({ cardNumber }: { cardNumber: string }) {
  const active = usePageActivity();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); }, [active, cardNumber]);
  const display = revealed ? formatCardFa(cardNumber) : maskCardNumber(cardNumber);

  return <div className="bank-card-number-row">
    <span className="account-card-number" dir="ltr">
      {display.split(" ").map((group, index) => <span key={index}>{group}</span>)}
    </span>
    <button type="button" className="icon-btn bank-card-number-toggle"
      aria-label={revealed ? "پنهان کردن شماره کارت" : "نمایش شماره کارت"}
      aria-pressed={revealed}
      onClick={event => { event.stopPropagation(); setRevealed(value => !value); }}
      onKeyDown={event => event.stopPropagation()}>
      <Icon name={revealed ? "i-eye-off" : "i-eye"} />
    </button>
  </div>;
}

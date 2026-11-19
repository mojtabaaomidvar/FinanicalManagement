import { useId } from "react";

export type BillboardSection = "transaction" | "wallets" | "budget" | "dues";

/** Local vector artwork keeps the poster crisp at every screen size. */
export function HomeBillboardArt({ section }: { section: BillboardSection }) {
  const id = useId();
  const paper = `${id}-paper`, shadow = `${id}-shadow`, coin = `${id}-coin`;
  return <svg className="home-billboard-art" viewBox="0 0 240 240" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={paper} x1="50" y1="40" x2="170" y2="220" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fff8e8" /><stop offset="1" stopColor="#e8d8b8" />
      </linearGradient>
      <linearGradient id={coin} x1="130" y1="70" x2="205" y2="185" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fff3af" /><stop offset="1" stopColor="#d69b40" />
      </linearGradient>
      <filter id={shadow} x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="12" stdDeviation="9" floodColor="#081e22" floodOpacity=".24" />
      </filter>
    </defs>
    <circle cx="122" cy="126" r="95" stroke="currentColor" strokeOpacity=".18" />
    <circle cx="122" cy="126" r="73" stroke="currentColor" strokeOpacity=".12" strokeDasharray="2 8" />
    <path d="M10 165h38M180 32h43M22 63l17 17M189 203l15 15" stroke="currentColor" strokeOpacity=".3" strokeWidth="2" />
    <path d="m204 65 3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9Z" fill="currentColor" opacity=".7" />
    <circle cx="42" cy="192" r="4" fill="currentColor" opacity=".6" />
    {section === "transaction" ? <>
      <g transform="rotate(-11 113 124)" filter={`url(#${shadow})`}>
        <path d="M65 39h101v164l-10-7-10 7-10-7-10 7-10-7-10 7-10-7-10 7-10-7-10 7V39Z" fill={`url(#${paper})`} />
        <rect x="80" y="57" width="45" height="8" rx="4" fill="#254e44" />
        <path d="M81 80h68M81 96h44M81 112h59" stroke="#789080" strokeWidth="6" strokeLinecap="round" />
        <path d="M81 133h68" stroke="#acb7a0" strokeDasharray="3 5" />
        <path d="M82 153h31M82 170h49" stroke="#254e44" strokeWidth="8" strokeLinecap="round" />
      </g>
      <g transform="rotate(10 170 158)" filter={`url(#${shadow})`}>
        <rect x="123" y="123" width="90" height="67" rx="13" fill="#b5d995" />
        <rect x="135" y="136" width="19" height="14" rx="4" fill="#eaf2cb" />
        <path d="M138 170h31M178 170h18" stroke="#235646" strokeWidth="4" strokeLinecap="round" />
      </g>
      <circle cx="62" cy="51" r="22" fill="#dff4a6" filter={`url(#${shadow})`} />
      <path d="M62 41v20M52 51h20" stroke="#17483b" strokeWidth="3" strokeLinecap="round" />
    </> : section === "wallets" ? <>
      <g transform="rotate(-9 114 143)" filter={`url(#${shadow})`}>
        <rect x="54" y="58" width="102" height="77" rx="9" fill="#b9d9c4" />
        <rect x="67" y="67" width="98" height="79" rx="9" fill="#e3e6bc" />
        <path d="M85 86h60M85 99h37" stroke="#608679" strokeWidth="5" strokeLinecap="round" />
        <path d="M43 99a17 17 0 0 1 17-17h91a16 16 0 0 1 16 16v14H59a16 16 0 0 0-16 16V99Z" fill="#b67742" />
        <rect x="42" y="103" width="147" height="90" rx="18" fill="#dea96b" />
        <path d="M53 119h121v59H53v-59Z" stroke="#a9713e" strokeDasharray="3 5" />
        <rect x="145" y="133" width="51" height="35" rx="10" fill="#f4d59d" />
        <circle cx="159" cy="150" r="5" fill="#805633" />
      </g>
      <circle cx="174" cy="65" r="30" fill={`url(#${coin})`} filter={`url(#${shadow})`} />
      <circle cx="174" cy="65" r="21" stroke="#b98434" strokeWidth="2" />
      <path d="m164 66 7 6 13-15" stroke="#805927" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="74" cy="201" rx="23" ry="8" fill="#bc853a" />
      <ellipse cx="74" cy="196" rx="23" ry="8" fill="#f1cd76" />
      <ellipse cx="74" cy="189" rx="23" ry="8" fill="#ffdf90" />
    </> : section === "budget" ? <>
      <g transform="rotate(-8 120 129)" filter={`url(#${shadow})`}>
        <rect x="48" y="45" width="143" height="163" rx="19" fill={`url(#${paper})`} />
        <rect x="65" y="60" width="68" height="7" rx="3.5" fill="#8b493e" />
        <circle cx="120" cy="115" r="32" stroke="#ddc3a1" strokeWidth="14" />
        <path d="M120 83a32 32 0 1 1-30 43" stroke="#b8664c" strokeWidth="14" strokeLinecap="round" />
        <circle cx="120" cy="115" r="7" fill="#b8664c" />
        <rect x="68" y="169" width="16" height="21" rx="4" fill="#e8bb82" />
        <rect x="98" y="154" width="16" height="36" rx="4" fill="#cf9971" />
        <rect x="128" y="160" width="16" height="30" rx="4" fill="#b96951" />
        <rect x="158" y="144" width="16" height="46" rx="4" fill="#854a3c" />
      </g>
      <circle cx="188" cy="161" r="27" fill={`url(#${coin})`} filter={`url(#${shadow})`} />
      <path d="m177 161 8 8 13-16" stroke="#845729" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </> : <>
      <g transform="rotate(8 123 125)" filter={`url(#${shadow})`}>
        <rect x="52" y="49" width="145" height="153" rx="18" fill={`url(#${paper})`} />
        <path d="M52 68a19 19 0 0 1 19-19h107a19 19 0 0 1 19 19v24H52V68Z" fill="#e3a47d" />
        <path d="M86 40v25M162 40v25" stroke="#f8e8cc" strokeWidth="8" strokeLinecap="round" />
        {[112, 139, 166].flatMap(y => [78, 111, 144, 177].map(x =>
          <rect key={`${x}:${y}`} x={x - 6} y={y - 6} width="12" height="12" rx="3" fill="#d7c7ad" />))}
        <rect x="132" y="127" width="24" height="24" rx="7" fill="#446b79" />
        <path d="m138 140 4 4 9-11" stroke="#fff7e3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="62" cy="165" r="34" fill="#b7d4d2" filter={`url(#${shadow})`} />
      <circle cx="62" cy="165" r="26" stroke="#3b6470" strokeWidth="2" />
      <path d="M62 148v18l11 6" stroke="#3b6470" strokeWidth="3" strokeLinecap="round" />
    </>}
  </svg>;
}

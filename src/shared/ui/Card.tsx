/* Card — کارت پایه محتوای اپ */

import type { ReactNode } from "react";

export function Card(props: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      {props.title || props.action ? (
        <div className="card-head">
          {props.title ? <h3>{props.title}</h3> : null}
          {props.action}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

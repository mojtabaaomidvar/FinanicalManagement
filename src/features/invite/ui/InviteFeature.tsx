/* UI دعوت عضو — مودال لینک + QR */

import { useEffect, useRef } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useInviteModel } from "../model/useInviteModel";
import { Modal } from "@/shared/ui";
import { drawQrToCanvas } from "@/shared/lib/qr";

export function InviteFeature() {
  const { useCases, family } = useApp();
  const { show } = useToast();
  const m = useInviteModel(useCases!, show);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (m.open && m.link && canvasRef.current) {
      drawQrToCanvas(canvasRef.current, m.link);
    }
  }, [m.open, m.link]);

  return (
    <>
      <div className="invite-box">
        <p className="invite-title">دعوت عضو جدید</p>
        <p className="invite-sub">
          لینک دعوت زیر را برای عضو خانوادتون بفرتسین تا به جمع خانواده شما تو
          نرم افزار اضافه بشه
        </p>
        <div className="invite-actions">
          <button className="action-btn" disabled={m.busy} onClick={m.create}>
            لینک دعوت
          </button>
        </div>
      </div>

      <Modal
        open={m.open}
        onClose={() => m.setOpen(false)}
        sheetClassName="invite-sheet"
      >
        <div className="pending-head">
          <h3>دعوت عضو جدید</h3>
        </div>

        <div className="invite-qr-wrap">
          <canvas ref={canvasRef} />
        </div>

        <p className="invite-link-label">لینک دعوت:</p>
        <div className="invite-link-row">
          <input
            type="text"
            className="text-input"
            readOnly
            dir="ltr"
            value={m.link}
          />
        </div>
        <button
          className="btn-ghost btn-block"
          onClick={() => m.share(family?.name ?? "خانواده")}
        >
          اشتراک‌گذاری لینک
        </button>
      </Modal>
    </>
  );
}

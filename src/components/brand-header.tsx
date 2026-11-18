import type { ReactNode } from "react";
import Link from "next/link";

export function BrandHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/" aria-label="HyperData Lab Research Hub">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">HyperData Lab</span>
          <span className="brand-separator" aria-hidden="true" />
          <span className="brand-product">Research Hub</span>
        </Link>
        {actions && <div className="topbar-right">{actions}</div>}
      </div>
    </header>
  );
}

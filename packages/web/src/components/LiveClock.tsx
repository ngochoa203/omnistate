import { memo, useEffect, useState } from "react";

interface Props {
  withSeconds?: boolean;
  className?: string;
}

export const LiveClock = memo(function LiveClock({ withSeconds = true, className }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), withSeconds ? 1000 : 60000);
    return () => clearInterval(interval);
  }, [withSeconds]);

  return <span className={className}>{now.toLocaleTimeString([], withSeconds ? undefined : { hour: "2-digit", minute: "2-digit" })}</span>;
});
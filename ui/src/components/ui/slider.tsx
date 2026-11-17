import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  rangeColor?: string;
  /** Number of detent ticks drawn under the track (0 for none). Values 0-9 use 10. */
  ticks?: number;
};

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, rangeColor, ticks = 0, ...props }, ref) => (
    <SliderPrimitive.Root
      ref={ref}
      className={cn("relative flex w-full touch-none select-none items-center py-2.5", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-px w-full grow bg-[var(--line-strong)]">
        <SliderPrimitive.Range className="absolute h-full bg-[var(--text)]" style={rangeColor ? { background: rangeColor } : undefined} />
        {ticks > 1 && (
          <span aria-hidden className="pointer-events-none absolute inset-x-[5px] top-1.5 flex justify-between">
            {Array.from({ length: ticks }, (_, i) => (
              <span key={i} className="h-[3px] w-px bg-[var(--line-strong)]" />
            ))}
          </span>
        )}
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="keycap block h-[18px] w-[10px] rounded-[3px] disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

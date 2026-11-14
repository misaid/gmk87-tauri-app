import { ProfileGallery } from "@/components/ProfileGallery";

export default function ProfilesScreen() {
  return (
    <section className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4 text-[13px]" aria-labelledby="profiles-heading">
      <h2 id="profiles-heading" className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
        Looks and profiles
      </h2>
      <p className="mb-3 mt-1 text-[12px] text-[var(--muted)]">Click a card to apply it. Save the current lighting as a profile with the first card; rename or delete your own below.</p>
      <ProfileGallery />
    </section>
  );
}

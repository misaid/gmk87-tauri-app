import { ProfileGallery } from "@/components/ProfileGallery";

export default function ProfilesScreen() {
  return (
    <section className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-4 text-[13px]" aria-labelledby="profiles-heading">
      <h2 id="profiles-heading" className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text)]">
        Profiles
      </h2>
      <ProfileGallery />
    </section>
  );
}

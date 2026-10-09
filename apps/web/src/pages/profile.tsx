import { ThemeSwitcher } from "@/shell/theme-switcher";

export const ProfilePage = () => (
  <section>
    <h1 className="text-title">Profile</h1>
    <h2 className="mt-8 text-subtitle">Display</h2>
    <div className="mt-4">
      <ThemeSwitcher />
    </div>
  </section>
);

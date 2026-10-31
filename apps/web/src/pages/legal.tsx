import { LEGAL_NOTICE } from "@/legal/legal-notice";
import { LegalPage } from "@/legal/legal-page";
import { PRIVACY } from "@/legal/privacy";
import { TERMS } from "@/legal/terms";

export const LegalNoticePage = () => (
  <LegalPage path="/legal" versions={LEGAL_NOTICE} contents={false} />
);

export const PrivacyPage = () => <LegalPage path="/privacy" versions={PRIVACY} contents />;

export const TermsPage = () => <LegalPage path="/terms" versions={TERMS} contents />;

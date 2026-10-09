import { Link } from "@tanstack/react-router";

export const NotFoundPage = () => (
  <section>
    <h1 className="text-title">Page not found</h1>
    <Link to="/" className="mt-4 inline-flex min-h-11 items-center underline">
      Back to Today
    </Link>
  </section>
);

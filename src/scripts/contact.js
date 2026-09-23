import { onPage } from "./utils.js";

// Progressive enhancement over a plain <form>: native constraint validation
// runs first (the submit event only fires for a valid form), then the message
// is posted as JSON without leaving the page.
onPage("#contact-form", (form) => {
  const status = document.getElementById("form-status");
  const submit = form.querySelector("button[type='submit']");
  const label = submit.textContent;

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = "Sending…";
    setStatus("");

    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.ok) {
        setStatus("Thank you — your message has been sent.");
        form.reset();
      } else {
        setStatus(result.error || "Something went wrong. Please try again.", true);
      }
    } catch {
      setStatus("Couldn't reach the server. Check your connection and try again.", true);
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
});

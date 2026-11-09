/* ==========================================================================
   Questionnaire behaviour. No dependencies and no requests, apart from the
   form post on hosts that can receive one.

   All wording lives in index.html as data-msg-* attributes on the form, and
   every field is in the static HTML. Without this script all fields show and
   the form is a plain POST.
   ========================================================================== */

(function () {
  "use strict";

  var form = document.querySelector('form[name="marcos-questionnaire"]');
  if (!form) return;

  var DRAFT_KEY = "marcos-questionnaire-draft";
  var DRAFT_DELAY_MS = 400;
  var SEND_TIMEOUT_MS = 20000;

  function all(selector, root) {
    return Array.prototype.slice.call((root || form).querySelectorAll(selector));
  }

  function one(selector, root) {
    return (root || form).querySelector(selector);
  }

  function msg(key) {
    return form.getAttribute("data-msg-" + key) || "";
  }

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (match, key) {
      return key in values ? values[key] : match;
    });
  }

  var ui = {
    progress: one("[data-progress]"),
    progressTrack: one("[data-progress-track]"),
    progressFill: one("[data-progress-fill]"),
    headerText: document.querySelector("[data-header-progress]"),
    headerTrack: document.querySelector("[data-header-track]"),
    headerFill: document.querySelector("[data-header-fill]"),
    headerCta: document.querySelector("[data-header-cta]"),
    draftLine: one("[data-draft-line]"),
    draftClear: one("[data-draft-clear]"),
    draftConfirm: one("[data-draft-confirm]"),
    draftYes: one("[data-draft-yes]"),
    draftNo: one("[data-draft-no]"),
    summary: one("[data-error-summary]"),
    summaryList: one("[data-error-list]"),
    previewText: one("[data-preview-text]"),
    send: one("[data-send]"),
    copy: one("[data-copy]"),
    download: one("[data-download]"),
    status: one("[data-status]"),
    fallback: one("[data-fallback]"),
    fallbackText: one("[data-fallback-text]")
  };

  /* ------------------------------------------------------------------
     The field model, read from the markup
     ------------------------------------------------------------------ */

  var fields = all("[data-field]").map(function (el) {
    var name = el.getAttribute("data-field");
    var kind = el.getAttribute("data-kind");
    var controls = all('[name="' + name + '"]', el);
    var isChoice = kind === "radio" || kind === "checkbox";
    return {
      el: el,
      name: name,
      kind: kind,
      isChoice: isChoice,
      required: el.getAttribute("data-required") === "true",
      max: parseInt(el.getAttribute("data-max"), 10) || 0,
      label: one(".fc-label__text", el).textContent.trim(),
      question: el.closest("[data-question]"),
      controls: controls,
      // Where aria-invalid and aria-describedby go: the group or the input.
      target: isChoice ? el : controls[0]
    };
  });

  var byName = {};
  fields.forEach(function (field) {
    byName[field.name] = field;
  });

  var questions = all("[data-question]").map(function (el) {
    return {
      el: el,
      n: el.getAttribute("data-n"),
      title: one(".fc-q__title", el).textContent.trim(),
      essential: el.getAttribute("data-essential") === "true",
      fields: fields.filter(function (field) {
        return field.question === el;
      })
    };
  });

  var conditions = all("[data-show-field]").map(function (el) {
    return {
      el: el,
      source: byName[el.getAttribute("data-show-field")],
      values: el.getAttribute("data-show-values").split(" "),
      fields: all("[data-field]", el).map(function (fieldEl) {
        return byName[fieldEl.getAttribute("data-field")];
      })
    };
  });

  function checked(field) {
    return field.controls.filter(function (control) {
      return control.checked;
    });
  }

  function isShown(field) {
    return !field.el.closest("[hidden]");
  }

  function hasValue(field) {
    return field.isChoice ? checked(field).length > 0 : field.controls[0].value.trim() !== "";
  }

  function isFullLink(value) {
    if (/\s/.test(value)) return false;
    try {
      var url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.indexOf(".") > 0;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------
     Conditional fields. Hidden fields are disabled too, so a prefilled
     value in a closed group is never posted.
     ------------------------------------------------------------------ */

  function applyConditions() {
    conditions.forEach(function (condition) {
      var current = checked(condition.source).map(function (control) {
        return control.value;
      });
      // Conditions run in page order, so a group inside a closed group stays closed.
      var show =
        !condition.el.parentElement.closest("[hidden]") &&
        current.some(function (value) {
          return condition.values.indexOf(value) !== -1;
        });
      condition.el.hidden = !show;
      condition.fields.forEach(function (field) {
        field.controls.forEach(function (control) {
          control.disabled = !show;
          control.required = show && field.required;
        });
        if (!show) clearError(field);
      });
    });
    renderSummary();
  }

  /* ------------------------------------------------------------------
     Validation
     ------------------------------------------------------------------ */

  var errors = {};

  function problemWith(field) {
    if (!isShown(field)) return "";
    if (field.isChoice) {
      if (field.max && checked(field).length > field.max) return msg("too-many");
      return field.required && !hasValue(field) ? msg("no-option") : "";
    }
    var value = field.controls[0].value.trim();
    // Only a required link has to be a full address. An optional one can hold any note, such as "n/a".
    if (field.kind === "url" && field.required) {
      if (!value) return msg("link-empty");
      return isFullLink(value) ? "" : msg("link-invalid");
    }
    return field.required && !value ? msg("text-empty") : "";
  }

  function errorId(field) {
    return field.name + "--error";
  }

  function setDescribedBy(field, on) {
    var id = errorId(field);
    var current = (field.target.getAttribute("aria-describedby") || "").split(" ").filter(function (part) {
      return part && part !== id;
    });
    if (on) current.unshift(id);
    if (current.length) {
      field.target.setAttribute("aria-describedby", current.join(" "));
    } else {
      field.target.removeAttribute("aria-describedby");
    }
  }

  function showInlineMessage(field, message) {
    var node = document.getElementById(errorId(field));
    if (!node) {
      node = document.createElement("p");
      node.id = errorId(field);
      node.className = "fc-error";
      var anchor = one(".fc-options, .fc-cards, .fc-input", field.el);
      anchor.parentNode.insertBefore(node, anchor);
    }
    node.textContent = message;
    setDescribedBy(field, true);
    return node;
  }

  function setError(field, message) {
    errors[field.name] = message;
    showInlineMessage(field, message);
    field.target.setAttribute("aria-invalid", "true");
  }

  function clearError(field) {
    delete errors[field.name];
    var node = document.getElementById(errorId(field));
    if (node) node.parentNode.removeChild(node);
    setDescribedBy(field, false);
    field.target.removeAttribute("aria-invalid");
  }

  function goToField(field) {
    var control = checked(field)[0] || field.controls[0];
    field.el.scrollIntoView({ block: "center" });
    control.focus({ preventScroll: true });
  }

  function withColon(label) {
    return label + (/[?:]$/.test(label) ? "" : ":");
  }

  function renderSummary() {
    ui.summaryList.textContent = "";
    var failing = fields.filter(function (field) {
      return errors[field.name];
    });
    failing.forEach(function (field) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#" + field.controls[0].id;
      link.textContent = fill(msg("error-link"), {
        n: field.question.getAttribute("data-n"),
        label: withColon(field.label),
        message: errors[field.name]
      });
      link.addEventListener("click", function (event) {
        event.preventDefault();
        goToField(field);
      });
      item.appendChild(link);
      ui.summaryList.appendChild(item);
    });
    ui.summary.hidden = failing.length === 0;
  }

  function validate() {
    var count = 0;
    fields.forEach(function (field) {
      var problem = problemWith(field);
      if (problem) {
        setError(field, problem);
        count += 1;
      } else {
        clearError(field);
      }
    });
    renderSummary();
    if (count) {
      ui.summary.focus({ preventScroll: true });
      ui.summary.scrollIntoView({ block: "start" });
    }
    return count === 0;
  }

  /* ------------------------------------------------------------------
     Progress. A question counts as answered when all its visible required
     answers are in; a question with none needs any one answer.
     ------------------------------------------------------------------ */

  /* Progress counts the questions with a Required answer, so it reaches the
     end at the moment the form can be shared. */
  var trackedQuestions = questions.filter(function (question) {
    return (
      question.essential &&
      question.fields.some(function (field) {
        return field.required;
      })
    );
  });

  function isAnswered(question) {
    var shown = question.fields.filter(isShown);
    var required = shown.filter(function (field) {
      return field.required;
    });
    if (required.length) {
      return required.every(function (field) {
        return hasValue(field) && !problemWith(field);
      });
    }
    return shown.some(hasValue);
  }

  var allAnswered = false;
  var inForm = false;
  var ctaText = ui.headerCta.textContent;
  var ctaHref = ui.headerCta.getAttribute("href");

  /* While the form is on screen, the header button gives way to the progress
     line. Once every required answer is in, it comes back and leads to the
     last step, which can be a long way down on a phone. */
  function updateHeader() {
    var toLastStep = inForm && allAnswered;
    ui.headerCta.hidden = inForm && !allAnswered;
    ui.headerCta.textContent = toLastStep ? msg("header-last-step") : ctaText;
    ui.headerCta.setAttribute("href", toLastStep ? "#last-step" : ctaHref);
    ui.headerText.hidden = !inForm || allAnswered;
    ui.headerTrack.hidden = !inForm;
  }

  function updateProgress() {
    var total = trackedQuestions.length;
    var answered = trackedQuestions.filter(isAnswered).length;
    var text = fill(msg("progress"), { answered: answered, total: total });
    var scale = "scaleX(" + answered / total + ")";
    // Written only on a change, so the live region speaks only then.
    if (ui.progress.textContent !== text) ui.progress.textContent = text;
    ui.headerText.textContent = text;
    ui.progressFill.style.transform = scale;
    ui.headerFill.style.transform = scale;
    allAnswered = answered === total;
    updateHeader();
  }

  /* ------------------------------------------------------------------
     Draft in this browser. The page works without it.
     ------------------------------------------------------------------ */

  var draftTimer = null;

  var storageWorks = (function () {
    try {
      var probe = DRAFT_KEY + "-probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function setDraftLine(text) {
    if (ui.draftLine.textContent !== text) ui.draftLine.textContent = text;
  }

  function showClearOption(on) {
    ui.draftClear.hidden = !on;
    if (!on) ui.draftConfirm.hidden = true;
  }

  function collectValues() {
    var values = {};
    fields.forEach(function (field) {
      if (field.isChoice) {
        values[field.name] = checked(field).map(function (control) {
          return control.value;
        });
        return;
      }
      // An untouched default stays out of the draft, so a corrected one reaches a returning visitor.
      var control = field.controls[0];
      if (control.value !== control.defaultValue) values[field.name] = control.value;
    });
    return values;
  }

  function applyValues(values) {
    fields.forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(values, field.name)) return;
      var value = values[field.name];
      if (field.isChoice) {
        field.controls.forEach(function (control) {
          control.checked = Array.isArray(value) && value.indexOf(control.value) !== -1;
        });
      } else if (typeof value === "string") {
        field.controls[0].value = value;
      }
    });
  }

  function saveDraft() {
    if (!storageWorks) return;
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ version: form.elements.form_version.value, values: collectValues() })
      );
      setDraftLine(msg("draft-saved"));
      showClearOption(true);
    } catch (e) {
      storageWorks = false;
      setDraftLine(msg("draft-unavailable"));
      showClearOption(false);
    }
  }

  function scheduleDraft() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, DRAFT_DELAY_MS);
  }

  function forgetDraft() {
    window.clearTimeout(draftTimer);
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* Storage is off, so there is nothing to forget. */
    }
  }

  function restoreDraft() {
    if (!storageWorks) {
      setDraftLine(msg("draft-unavailable"));
      return;
    }
    var saved = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
    } catch (e) {
      saved = null;
    }
    if (saved && saved.values && typeof saved.values === "object") {
      applyValues(saved.values);
      setDraftLine(msg("draft-restored"));
      showClearOption(true);
    }
  }

  function clearEverything() {
    forgetDraft();
    form.reset();
    fields.forEach(clearError);
    applyConditions();
    updateProgress();
    clearDelivery();
    applyMode();
    setDraftLine(msg("draft-cleared"));
    showClearOption(false);
    ui.draftLine.focus();
  }

  ui.draftClear.addEventListener("click", function () {
    ui.draftConfirm.hidden = false;
    ui.draftClear.hidden = true;
    ui.draftYes.focus();
  });

  ui.draftNo.addEventListener("click", function () {
    ui.draftConfirm.hidden = true;
    ui.draftClear.hidden = false;
    ui.draftClear.focus();
  });

  ui.draftYes.addEventListener("click", clearEverything);

  /* ------------------------------------------------------------------
     Plain-text summary: question title, then answers. Hidden fields are
     left out and blank ones read "Not answered".
     ------------------------------------------------------------------ */

  function answerText(field) {
    if (field.isChoice) {
      return checked(field)
        .map(function (control) {
          return control.closest("label").textContent.trim();
        })
        .join(", ");
    }
    return field.controls[0].value.trim();
  }

  /* A value we filled in from a public page and the visitor has not changed. The
     text and the post say so, so nobody reads it as confirmed. */
  function isUntouchedPrefill(field) {
    if (field.isChoice) return false;
    var control = field.controls[0];
    var prefill = control.defaultValue.trim();
    return prefill !== "" && control.value.trim() === prefill;
  }

  function fieldLines(field) {
    var answer = answerText(field) || msg("blank");
    if (isUntouchedPrefill(field)) answer += " " + msg("prefill-note");
    var lines = answer.split(/\r?\n/);
    if (lines.length > 1) {
      return [withColon(field.label)].concat(
        lines.map(function (line) {
          return "  " + line;
        })
      );
    }
    return [withColon(field.label) + " " + answer];
  }

  function buildSummary() {
    var version = form.elements.form_version.value;
    var created = new Date(form.elements.submitted_at.value).toLocaleString("en-GB", {
      dateStyle: "long",
      timeStyle: "long"
    });
    var lines = [
      msg("download-heading"),
      fill(msg("summary-version"), { version: version }),
      fill(msg("summary-created"), { date: created })
    ];
    all("[data-part]").forEach(function (part) {
      lines.push("", one("[data-part-title]", part).textContent.trim());
      questions
        .filter(function (question) {
          return part.contains(question.el);
        })
        .forEach(function (question) {
          lines.push("", question.n + ". " + question.title);
          question.fields.filter(isShown).forEach(function (field) {
            lines = lines.concat(fieldLines(field));
          });
        });
    });
    return lines.join("\n") + "\n";
  }

  function stamp() {
    form.elements.submitted_at.value = new Date().toISOString();
    var untouched = [];
    questions.forEach(function (question) {
      question.fields.filter(isShown).forEach(function (field) {
        if (isUntouchedPrefill(field)) untouched.push(field.name);
      });
    });
    form.elements.prefilled_unchanged.value = untouched.join(" ");
  }

  /* ------------------------------------------------------------------
     Delivery modes. On GitHub Pages and on a local server nothing can be
     posted, so the last step offers copy and download. Anywhere else the
     form posts in the background. data-delivery="preview" or "post" on the
     form overrides the choice.
     ------------------------------------------------------------------ */

  var mode = "preview";
  var sending = false;
  var editedWhileSending = false;
  var sent = false;
  var statusKind = "";

  function detectMode() {
    var forced = form.getAttribute("data-delivery");
    if (forced === "preview" || forced === "post") return forced;
    var host = window.location.hostname;
    var local = host === "" || host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    return local || /\.github\.io$/i.test(host) ? "preview" : "post";
  }

  function applyMode() {
    mode = detectMode();
    form.setAttribute("data-mode", mode);
    ui.previewText.hidden = mode !== "preview";
    ui.send.hidden = mode !== "post";
    ui.copy.hidden = mode !== "preview";
    ui.download.hidden = mode !== "preview";
    // Sending is the main action where it exists; copying then steps back.
    ui.copy.classList.toggle("fc-btn--outline", mode === "post");
  }

  function setStatus(text, kind, moveFocus) {
    statusKind = kind || "";
    ui.status.className = "fc-status" + (kind ? " fc-status--" + kind : "");
    ui.status.textContent = text;
    if (moveFocus) ui.status.focus();
  }

  function clearDelivery() {
    sent = false;
    ui.send.removeAttribute("aria-disabled");
    setStatus("");
    ui.fallback.hidden = true;
    ui.fallbackText.value = "";
  }

  /* An answer changed after a copy, download or send, so the confirmation and
     any text in the fallback box no longer match the page. A failed send stays
     on screen with its options: it is still true. */
  function deliveryIsStale() {
    if (sending) {
      editedWhileSending = true;
      return;
    }
    if (sent) {
      // The visitor edited after a successful send: say so instead of going quiet.
      clearDelivery();
      setStatus(msg("sent-earlier"));
      return;
    }
    if (statusKind === "ok" || !ui.fallback.hidden) clearDelivery();
  }

  // Copy

  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.tabIndex = -1;
    area.className = "fc-hp";
    document.body.appendChild(area);
    area.select();
    var worked = false;
    try {
      worked = document.execCommand("copy");
    } catch (e) {
      worked = false;
    }
    document.body.removeChild(area);
    return worked;
  }

  function copyConfirmed() {
    ui.fallback.hidden = true;
    setStatus(msg("copied"), "ok", true);
  }

  function copyBlocked(text) {
    ui.fallbackText.value = text;
    ui.fallback.hidden = false;
    setStatus(msg("copy-blocked"), "error", true);
  }

  function copyAnswers() {
    if (!validate()) return;
    stamp();
    var text = buildSummary();
    function fallBack() {
      if (legacyCopy(text)) {
        copyConfirmed();
      } else {
        copyBlocked(text);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copyConfirmed, fallBack);
    } else {
      fallBack();
    }
  }

  // Download

  function fileName() {
    var now = new Date();
    var pad = function (number) {
      return (number < 10 ? "0" : "") + number;
    };
    var date = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    return form.getAttribute("data-download-name") + "-" + date + ".txt";
  }

  var downloadLocked = false;

  function downloadAnswers() {
    // A double click should not leave two files behind.
    if (downloadLocked || !validate()) return;
    downloadLocked = true;
    window.setTimeout(function () {
      downloadLocked = false;
    }, 1000);
    stamp();
    // The byte order mark keeps € and accents right in older text editors.
    var blob = new Blob(["﻿" + buildSummary()], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10000);
    ui.fallback.hidden = true;
    ui.fallbackText.value = "";
    setStatus(msg("downloaded"), "ok", true);
  }

  // Send, on hosts that can receive the post

  function sendAnswers() {
    if (sending) return;
    if (sent) {
      ui.status.focus();
      return;
    }
    if (!validate()) return;

    sending = true;
    editedWhileSending = false;
    stamp();
    ui.send.setAttribute("aria-disabled", "true");
    setStatus(msg("sending"));

    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, SEND_TIMEOUT_MS)
      : null;

    window
      .fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form)).toString(),
        signal: controller ? controller.signal : undefined
      })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        if (editedWhileSending) {
          // The post left before this edit, so the newer answers stay here and in the draft.
          ui.send.removeAttribute("aria-disabled");
          setStatus(msg("sent-earlier"), "", true);
          return;
        }
        sent = true;
        forgetDraft();
        setDraftLine("");
        showClearOption(false);
        ui.copy.hidden = true;
        ui.download.hidden = true;
        setStatus(msg("sent"), "ok", true);
      })
      .catch(function () {
        ui.send.removeAttribute("aria-disabled");
        ui.copy.hidden = false;
        ui.download.hidden = false;
        setStatus(msg("send-failed"), "error", true);
      })
      .then(function () {
        window.clearTimeout(timer);
        sending = false;
      });
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */

  function afterEdit(field) {
    if (errors[field.name]) {
      var problem = problemWith(field);
      if (problem) {
        setError(field, problem);
      } else {
        clearError(field);
      }
      renderSummary();
    }
    updateProgress();
    scheduleDraft();
    deliveryIsStale();
  }

  function enforceMax(field, control) {
    if (control.checked && checked(field).length > field.max) {
      control.checked = false;
      showInlineMessage(field, msg("too-many")).setAttribute("role", "alert");
    } else {
      clearError(field);
      renderSummary();
    }
  }

  // Radios and checkboxes report on change, typed fields on input.
  form.addEventListener("change", function (event) {
    var field = byName[event.target.name];
    if (!field || !field.isChoice) return;
    if (field.max) enforceMax(field, event.target);
    applyConditions();
    afterEdit(field);
  });

  form.addEventListener("input", function (event) {
    var field = byName[event.target.name];
    if (!field || field.isChoice) return;
    afterEdit(field);
  });

  // In a form this long, Enter in a field must not end the questionnaire.
  form.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && event.target.tagName === "INPUT") event.preventDefault();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (mode === "post") {
      sendAnswers();
    } else if (validate()) {
      ui.copy.focus();
    }
  });

  ui.copy.addEventListener("click", copyAnswers);
  ui.download.addEventListener("click", downloadAnswers);

  ui.fallbackText.addEventListener("focus", function () {
    ui.fallbackText.select();
    ui.fallbackText.scrollTop = 0;
  });

  /* ------------------------------------------------------------------
     Header: while the form is on screen, the button gives way to the
     progress line and the hairline fills up.
     ------------------------------------------------------------------ */

  function watchHeader() {
    if (!window.IntersectionObserver) return;
    var formHead = one(".fc-form__head");
    var atTop = { form: false, head: false };
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          atTop[entry.target === form ? "form" : "head"] = entry.isIntersecting;
        });
        inForm = atTop.form && !atTop.head;
        updateHeader();
      },
      { rootMargin: "0px 0px -90% 0px" }
    );
    observer.observe(form);
    observer.observe(formHead);
  }

  /* ------------------------------------------------------------------
     Start
     ------------------------------------------------------------------ */

  // Our own validation takes over from the browser's bubbles.
  form.noValidate = true;

  applyMode();
  new MutationObserver(applyMode).observe(form, { attributes: true, attributeFilter: ["data-delivery"] });

  restoreDraft();
  applyConditions();
  updateProgress();

  ui.progress.hidden = false;
  ui.progressTrack.hidden = false;
  watchHeader();
})();

// What each ticket type asks. The details box opens pre-filled with a format, so people see exactly
// what to write and only have to fill in the blanks.
const SUBJECT = { id: 'subject', label: 'Subject', style: 'short', min: 4, max: 80, placeholder: 'A short title for your ticket' };
const USERNAME = { id: 'username', label: 'Your username', style: 'short', min: 2, max: 60, placeholder: 'Your Discord or in-game username' };

const TEMPLATES = {
  support:
    'What do you need help with:\n\nWhat have you already tried:\n\nAnything else we should know:\n',
  report:
    'What happened:\n\nWhen it happened:\n\nEvidence (links to screenshots or videos):\n',
  services:
    'What do you need built:\n\nBudget:\n\nDeadline:\n\nExamples or references:\n',
  partnership:
    'Server or group name:\n\nMember count:\n\nInvite link:\n\nWhat you are proposing:\n',
  application:
    'Age and timezone:\n\nExperience:\n\nWhy you want this role:\n\nHours you can give per week:\n',
};

const DETAILS_LABEL = {
  support: 'Your request', report: 'Your complaint', services: 'Your request',
  partnership: 'Your proposal', application: 'Your application',
};

const REPORTED = { id: 'reported', label: 'Member you are reporting', style: 'short', min: 2, max: 80, placeholder: 'Username or ID' };

function formFor(type) {
  const details = {
    id: 'details', label: DETAILS_LABEL[type], style: 'paragraph', min: 40, max: 1500, template: TEMPLATES[type],
  };
  const fields = type === 'report' ? [SUBJECT, USERNAME, REPORTED, details] : [SUBJECT, USERNAME, details];
  if (type === 'application') fields[0] = { ...SUBJECT, label: 'Position applying for', placeholder: 'For example: Moderator' };
  return fields;
}

// Returns an error message, or null when the answers are usable.
function validateForm(type, values) {
  for (const field of formFor(type)) {
    const value = String(values[field.id] ?? '').trim();
    if (value.length < field.min) {
      return field.id === 'details'
        ? 'Please fill in the format in the details box. It needs a bit more than that.'
        : `"${field.label}" is too short.`;
    }
    if (field.template && value === field.template.trim()) {
      return 'The details box still has the empty format in it. Please fill in the blanks.';
    }
  }
  return null;
}

module.exports = { formFor, validateForm, TEMPLATES };

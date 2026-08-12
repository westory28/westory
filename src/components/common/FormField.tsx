import React from "react";

interface FormFieldProps {
  children: React.ReactNode;
  label: string;
  htmlFor: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  children,
  label,
  htmlFor,
  description,
  error,
  required = false,
  className = "",
}) => {
  const descriptionId = description ? `${htmlFor}-description` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={`ws-form-field ${className}`.trim()}>
      <label className="ws-form-field__label" htmlFor={htmlFor}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> 필수</span>}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(
            children as React.ReactElement<{
              "aria-describedby"?: string;
              "aria-invalid"?: boolean;
            }>,
            {
              "aria-describedby":
                [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
              "aria-invalid": Boolean(error) || undefined,
            },
          )
        : children}
      {description && (
        <p id={descriptionId} className="ws-form-field__description">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="ws-form-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default FormField;

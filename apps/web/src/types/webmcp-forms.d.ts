/* eslint-disable @typescript-eslint/no-unused-vars -- merging into React's interfaces must repeat their type parameter */
import "react";

// WebMCP's declarative attributes (https://developer.chrome.com/docs/ai/webmcp/declarative-api): a form
// becomes a tool a browser agent can fill. React passes these lowercase attributes through to the DOM.
declare module "react" {
  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: boolean;
  }
  interface InputHTMLAttributes<T> {
    toolparamdescription?: string;
  }
  interface TextareaHTMLAttributes<T> {
    toolparamdescription?: string;
  }
  interface SelectHTMLAttributes<T> {
    toolparamdescription?: string;
  }
}

/**
 * Console categories, in the order the AWS Management Console lists them.
 * LocalDeck keeps the same grouping so the sidebar reads like the console it
 * is modeled on.
 */
export type ServiceCategory =
  | 'Compute'
  | 'Containers'
  | 'Storage'
  | 'Database'
  | 'Networking & CDN'
  | 'Security Identity & Compliance'
  | 'Application Integration'
  | 'Analytics'
  | 'Management & Governance'
  | 'Developer Tools'
  | 'Machine Learning';

export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  'Compute',
  'Containers',
  'Storage',
  'Database',
  'Networking & CDN',
  'Security Identity & Compliance',
  'Application Integration',
  'Analytics',
  'Management & Governance',
  'Developer Tools',
  'Machine Learning',
];

/**
 * How far LocalDeck's support for a service goes:
 * - `dedicated` — a hand-written module (list, detail, create wizard).
 * - `browser` — generated resource browser driven by list/describe operations.
 * - `planned` — registered for navigation and search, no operations yet.
 */
export type ServiceParityLevel = 'dedicated' | 'browser' | 'planned';

/** Values the generic browser may merge into an operation input. */
export type ServiceOperationInputValue =
  string | number | boolean | readonly (string | number | boolean)[];

/** Required parameters the generic browser always sends with an operation. */
export type ServiceOperationInput = Readonly<Record<string, ServiceOperationInputValue>>;

/**
 * One operation the generic browser can call. `operation` must appear in the
 * descriptor's whitelist; `input` carries the operation's required parameters
 * (for example the `Scope: 'REGIONAL'` WAF requires).
 */
export interface ServiceBrowserOperation {
  /** Whitelisted SDK operation name, e.g. `GetTopicAttributes`. */
  operation: string;
  /** Input merged into every call; carries the required parameters. */
  input?: ServiceOperationInput;
  /**
   * Input property that carries the resource identifier from the list row.
   * Points the operation at one resource (describe) or destroys one (delete).
   */
  idParam?: string;
  /** True when `idParam` expects an array with the identifier as its entry. */
  idParamIsArray?: boolean;
}

/**
 * The list operation — the generic browser's entry point (`listOp`). The
 * optional field paths tell the generated table which response property holds
 * the collection and which item fields identify and label one resource. They
 * are hints: the ui falls back to its tolerant inference when a field is
 * missing from a given response.
 */
export interface ServiceBrowserListOperation extends ServiceBrowserOperation {
  /** Dotted path to the collection in the response, e.g. `DistributionList.Items`. */
  resultPath?: string;
  /** Item field path(s); several are joined with "/" to form the resource id. */
  idField?: string | readonly string[];
  /** Item field path(s); several are joined with "/" to form the display name. */
  nameField?: string | readonly string[];
  /** Input property carrying the pagination token; defaults to `NextToken`. */
  nextTokenParam?: string;
}

/** Tags lookup for the detail view; falls back to tags in the describe result. */
export interface ServiceBrowserTagsOperation extends ServiceBrowserOperation {
  /** Dotted path to the tag array in the response; defaults to `Tags`. */
  resultPath?: string;
}

/**
 * How the generic browser drives one service: which whitelisted operations
 * list, describe, delete and (optionally) tag resources. Entries with a
 * `browser` spec render the generated list/detail pages; `planned` entries
 * only render the registry placeholder.
 */
export interface ServiceBrowserOperations {
  list: ServiceBrowserListOperation;
  describe?: ServiceBrowserOperation;
  delete?: ServiceBrowserOperation;
  tags?: ServiceBrowserTagsOperation;
}

export interface ServiceDescriptor {
  /**
   * Console id: the LocalStack service key when one exists (s3, dynamodb, …),
   * otherwise the name LocalDeck exposes (`timestream`). Used in routes:
   * /console/<id>/...
   */
  id: string;
  displayName: string;
  category: ServiceCategory;
  /** AWS SDK v3 package the api uses for this service. */
  sdkPackage: string;
  /** Key used to look up the official icon, with a Lucide fallback. */
  iconKey: string;
  /** Whitelisted AWS API operations the api may proxy for this service. */
  operations: readonly string[];
  parityLevel: ServiceParityLevel;
  /** One-line description used by search results and empty states. */
  summary: string;
  /** Additional LocalStack health keys that also mean "this service". */
  healthKeys?: readonly string[];
  /**
   * Generic-browser binding for dedicated and browser services: the list
   * operation plus its required parameters, and the optional describe, delete
   * and tags operations. `planned` entries have no browser spec yet.
   */
  browser?: ServiceBrowserOperations;
}

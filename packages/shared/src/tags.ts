/**
 * A resource tag in the shape AWS APIs use (`[{ Key, Value }]`), so SDK inputs
 * and responses can be passed through without conversion.
 */
export interface AwsTag {
  Key: string;
  Value: string;
}

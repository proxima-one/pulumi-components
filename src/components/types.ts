interface ComplexValue extends Readonly<Record<string, Value>> {}
interface ArrayValue extends ReadonlyArray<Value> {}
type Value = ArrayValue | ComplexValue | string | number | boolean | undefined | null;

export type JsonObject = ComplexValue;

export interface NewStorageClaim {
  size: string;
  class: string;
}

export interface ExistingStorageClaim {
  name: string;
}

export interface Resources {
  requests: ResourceMetric;
  limits: ResourceMetric;
}

export interface ResourceMetric {
  memory: string;
  cpu: string;
}

export interface NewRandomPassword {
  type: 'random';
  name: string;
}

export interface ExternalPassword {
  type: 'external';
  password: string;
}

export type Password = NewRandomPassword | ExternalPassword;

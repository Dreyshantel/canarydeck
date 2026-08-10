package main

# Every container must declare CPU and memory limits. Without this, one
# runaway container in a shared cluster can starve everything else,
# exactly the kind of "worked fine in the demo, took down the cluster in
# practice" gap this policy exists to catch before merge.

deny[msg] {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  not container.resources.limits.cpu
  msg := sprintf("container '%s' has no CPU limit set", [container.name])
}

deny[msg] {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  not container.resources.limits.memory
  msg := sprintf("container '%s' has no memory limit set", [container.name])
}

deny[msg] {
  input.kind == "Rollout"
  container := input.spec.template.spec.containers[_]
  not container.resources.limits.cpu
  msg := sprintf("container '%s' has no CPU limit set", [container.name])
}

deny[msg] {
  input.kind == "Rollout"
  container := input.spec.template.spec.containers[_]
  not container.resources.limits.memory
  msg := sprintf("container '%s' has no memory limit set", [container.name])
}

# Spec Delta

## MODIFIED Requirements

### Requirement: Platform capability is detected rather than assumed

Whether the platform can hold a persistent surface SHALL be determined at runtime, and the
surface's behaviour SHALL follow the detected capability.

The determination SHALL be made by asking the platform a question that platform can answer
about itself. A mechanism that exists on one platform and has no equivalent on another
SHALL NOT be the question asked of all of them, and a platform that does not implement the
mechanism being asked about SHALL NOT be recorded as lacking the capability.

#### Scenario: Capability differs by platform

- **WHEN** the same build runs on a platform that can hold a persistent surface and on one
  that cannot
- **THEN** it produces the appropriate idle behaviour on each, without a different build

#### Scenario: Each platform is asked about itself

- **WHEN** the capability is determined
- **THEN** each platform is asked a question it has an answer to, rather than every platform being asked the same question

#### Scenario: A platform that does not implement the mechanism being asked

- **WHEN** the question put to a platform concerns a mechanism that platform does not have
- **THEN** the absence of an answer is recorded as "cannot determine", not as "cannot hold a persistent surface", because the two have different consequences and only one of them is safe to act on

#### Scenario: The determining mechanism exists only on one platform

- **WHEN** a mechanism is consulted to decide the capability
- **THEN** its absence on a platform that has no equivalent is not evidence about that platform's capability

#### Scenario: The answer comes from the platform rather than the host

- **WHEN** the capability is determined
- **THEN** the answer is read from the platform's own state rather than from what the host recorded having asked for, because a host that records its own intent as the platform's answer will report a capability on every platform

#### Scenario: What the host asked for is not evidence

- **WHEN** a request to hold a surface above other windows was made
- **THEN** the request's success is not treated as evidence that it was honoured, since a platform may accept a request and discard it

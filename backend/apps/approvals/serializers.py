"""Approval-policy serializers with whitelisted condition validation."""

from collections.abc import Mapping

from rest_framework import serializers

from apps.accounts.models import User
from apps.approvals.models import ApprovalPolicy
from apps.approvals.policy import (
    FIELD_TYPES,
    MAX_RULES,
    MAX_STEPS,
    OPERATORS_BY_TYPE,
    ROLES,
    coerce_value,
)


class PolicySerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="rule_id")

    class Meta:
        model = ApprovalPolicy
        fields = ["id", "name", "priority", "active", "conditions", "steps"]


class PolicyWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    priority = serializers.IntegerField(required=False, min_value=0, default=100)
    active = serializers.BooleanField(required=False, default=True)
    conditions = serializers.JSONField(required=False, allow_null=True)
    steps = serializers.JSONField()

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def validate_steps(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("At least one step is required.")
        if len(value) > MAX_STEPS:
            raise serializers.ValidationError(
                f"At most {MAX_STEPS} steps are allowed."
            )

        normalized = []
        for index, step in enumerate(value, start=1):
            if not isinstance(step, dict):
                raise serializers.ValidationError("Each step must be an object.")
            unknown = set(step) - {"step_no", "role", "approver_id"}
            if unknown:
                raise serializers.ValidationError(
                    f"Unknown step fields: {sorted(unknown)}"
                )

            role = str(step.get("role") or "").upper()
            if role not in ROLES:
                raise serializers.ValidationError(
                    f"Invalid role {role!r}; expected one of {sorted(ROLES)}."
                )

            approver_id = step.get("approver_id")
            if approver_id not in (None, ""):
                if not isinstance(approver_id, str):
                    raise serializers.ValidationError(
                        "approver_id must be a string."
                    )
                approver = User.objects.filter(user_id=approver_id).first()
                if approver is None or not approver.is_active:
                    raise serializers.ValidationError(
                        f"Unknown or inactive approver: {approver_id!r}."
                    )
                if approver.role != role:
                    raise serializers.ValidationError(
                        f"Approver {approver_id!r} has role {approver.role!r}, "
                        f"not {role!r}."
                    )
                assignable = approver.status == User.Status.ACTIVE
                if not assignable and approver.status == User.Status.ON_LEAVE:
                    delegate = approver.delegate
                    assignable = bool(
                        delegate
                        and delegate.is_active
                        and delegate.status == User.Status.ACTIVE
                    )
                if not assignable:
                    raise serializers.ValidationError(
                        f"Approver {approver_id!r} is unavailable and has no "
                        "active delegate."
                    )

            normalized.append(
                {
                    "step_no": index,
                    "role": role,
                    "approver_id": approver_id,
                }
            )
        return normalized

    def validate(self, attrs):
        if not isinstance(self.initial_data, Mapping):
            raise serializers.ValidationError(
                {"detail": "Expected a JSON object."}
            )
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {"detail": f"Unknown fields: {sorted(unknown)}"}
            )
        if "conditions" in attrs:
            if attrs["conditions"] is None:
                attrs["conditions"] = {}
            self._validate_conditions(attrs["conditions"])
        else:
            self._validate_conditions({})
        return attrs

    def _validate_conditions(self, conditions):
        if not isinstance(conditions, dict):
            raise serializers.ValidationError(
                {"conditions": "Expected an object."}
            )
        unknown = set(conditions) - {"match", "rules"}
        if unknown:
            raise serializers.ValidationError(
                {"conditions": f"Unknown keys: {sorted(unknown)}"}
            )

        match = conditions.get("match", "all")
        if not isinstance(match, str) or match not in {"all", "any"}:
            raise serializers.ValidationError(
                {"conditions": "match must be 'all' or 'any'."}
            )

        rules = conditions.get("rules", [])
        if not isinstance(rules, list):
            raise serializers.ValidationError(
                {"conditions": "rules must be a list."}
            )
        if len(rules) > MAX_RULES:
            raise serializers.ValidationError(
                {"conditions": f"At most {MAX_RULES} rules are allowed."}
            )

        for rule in rules:
            if not isinstance(rule, dict):
                raise serializers.ValidationError(
                    {"conditions": "Each rule must be an object."}
                )
            unknown = set(rule) - {"field", "op", "value"}
            if unknown:
                raise serializers.ValidationError(
                    {"conditions": f"Unknown rule keys: {sorted(unknown)}"}
                )

            field = rule.get("field")
            op = rule.get("op")
            if not isinstance(field, str):
                raise serializers.ValidationError(
                    {"conditions": "field must be a string."}
                )
            field_type = FIELD_TYPES.get(field)
            if field_type is None:
                raise serializers.ValidationError(
                    {"conditions": f"Unknown field: {field!r}."}
                )
            if not isinstance(op, str) or op not in OPERATORS_BY_TYPE[field_type]:
                raise serializers.ValidationError(
                    {
                        "conditions": (
                            f"Operator {op!r} is not valid for {field} "
                            f"(allowed: {sorted(OPERATORS_BY_TYPE[field_type])})."
                        )
                    }
                )

            if op in {"is_null", "is_not_null"}:
                if "value" in rule:
                    raise serializers.ValidationError(
                        {"conditions": f"{op} does not take a value."}
                    )
                continue

            if "value" not in rule:
                raise serializers.ValidationError(
                    {"conditions": f"{op} requires a value."}
                )

            raw = rule["value"]
            if op in {"in", "not_in"}:
                if not isinstance(raw, list) or not raw:
                    raise serializers.ValidationError(
                        {"conditions": f"{op} requires a non-empty list."}
                    )
                try:
                    for item in raw:
                        coerce_value(item, field_type)
                except ValueError as exc:
                    raise serializers.ValidationError(
                        {"conditions": f"{field}: {exc}"}
                    )
            else:
                try:
                    coerce_value(raw, field_type)
                except ValueError as exc:
                    raise serializers.ValidationError(
                        {"conditions": f"{field}: {exc}"}
                    )

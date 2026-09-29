from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, field_validator

from app.scoring import WEIGHTS


class InputModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class Card(InputModel):
    title: str = Field(default="", max_length=160)
    context: str = Field(default="", max_length=2000)
    need: str = Field(default="", max_length=2000)
    users: str = Field(default="", max_length=2000)
    data: str = Field(default="", max_length=2000)
    constraints: str = Field(default="", max_length=2000)
    expected_result: str = Field(default="", max_length=2000)
    success_criteria: str = Field(default="", max_length=2000)
    contact: str = Field(default="", max_length=2000)
    interaction_format: str = Field(default="", max_length=2000)


class TaskInput(InputModel):
    topic: str = Field(min_length=1, max_length=80)
    card: Card
    confirmed_fields: list[str] = Field(default_factory=list, max_length=9)

    @field_validator("confirmed_fields")
    @classmethod
    def valid_confirmations(cls, fields: list[str]) -> list[str]:
        if len(fields) != len(set(fields)) or any(field not in WEIGHTS for field in fields):
            raise ValueError("Указаны повторяющиеся или неизвестные подтверждённые поля")
        return fields


class DraftInput(InputModel):
    draft: str = Field(min_length=10, max_length=6000)
    topic: str = Field(min_length=1, max_length=80)


class Answer(InputModel):
    question_id: str = Field(min_length=1, max_length=30)
    answer: str = Field(max_length=2000)


class CardGenerationInput(DraftInput):
    answers: list[Answer] = Field(default_factory=list, max_length=5)


class ProposalContent(InputModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    idea: str = Field(min_length=10, max_length=2000)
    plan: str = Field(min_length=10, max_length=2000)
    duration_days: int = Field(ge=1, le=365, strict=True)
    prototype_url: HttpUrl


class ProposalInput(ProposalContent):
    team_id: int = Field(gt=0, strict=True)


class TeamProfileInput(InputModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=2, max_length=100)
    interests: list[str] = Field(default_factory=list, max_length=16)
    skills: list[str] = Field(min_length=1, max_length=16)
    technologies: list[str] = Field(default_factory=list, max_length=16)

    @field_validator("interests", "skills", "technologies")
    @classmethod
    def profile_tags(cls, values: list[str]) -> list[str]:
        tags = list(dict.fromkeys(value.strip() for value in values))
        if any(not value or len(value) > 80 for value in tags):
            raise ValueError("Каждый пункт должен содержать от 1 до 80 символов")
        return tags


class DecisionInput(InputModel):
    status: Literal["selected", "rejected"]


class RegisterInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: Literal["BUSINESS", "TEAM"]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return str(value).casefold()


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return str(value).casefold()

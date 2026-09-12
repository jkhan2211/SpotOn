# SpotOn FastAPI backend — container image for Amazon ECS Express Mode (Fargate).
#
# Build from this directory:  docker build -t spoton-backend .
#
# This image contains NO configuration and NO credentials. Environment variables
# are injected at runtime (docker run --env-file locally; ECS
# primaryContainer.environment in production), and AWS credentials come from the
# ECS task role through boto3's default credential chain.

FROM python:3.13-slim

# Send stdout/stderr straight through instead of buffering it. Without this,
# Python holds log lines in a buffer and CloudWatch can show nothing at all when
# a container dies — which is precisely what made the AgentCore ProfileNotFound
# failure look like a timeout instead of an exception.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# uv is how this project pins dependencies (uv.lock). Installing it lets us build
# from the lockfile instead of re-resolving versions at image build time.
RUN pip install --no-cache-dir uv

WORKDIR /app

# Dependency manifests ONLY, copied before the source. Docker caches layers, so
# editing main.py later reuses this layer instead of reinstalling 76 packages.
COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-install-project --no-dev

# Put the virtualenv uv just created first on PATH so `uvicorn` below resolves to
# it. uv is then not involved at container start — one less moving part at runtime.
ENV PATH="/app/.venv/bin:$PATH"

# Application source. Anything in .dockerignore is skipped.
COPY . .

# Documentation only — EXPOSE publishes nothing by itself. The real mapping is
# `docker run -p` locally and containerPort in the ECS Express service.
EXPOSE 8000

# --host 0.0.0.0 is mandatory in a container: binding 127.0.0.1 makes the app
# unreachable from outside, and the ALB health check would fail with an
# "unhealthy task" loop that looks like an application bug.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM golang:1.26.7-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /platform ./cmd/platform

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /platform /platform
EXPOSE 8090
CMD ["/platform"]
